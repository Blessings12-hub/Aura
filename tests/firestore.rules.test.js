// tests/firestore.rules.test.js
//
// Regression tests for firestore.rules, run against the Firebase Local
// Emulator Suite (never against production — nothing here touches real
// data). This exists because the "permission-denied" bug fixed earlier
// (get-before-create on matchPairs/swapPairs/eventJoins) was exactly the
// kind of thing that's invisible from reading the rules casually and only
// shows up once a real user hits it — a test would have caught it before
// it shipped.
//
// Setup (one-time):
//   npm install --save-dev @firebase/rules-unit-testing vitest
//
// Run:
//   firebase emulators:exec --only firestore "npx vitest run tests/firestore.rules.test.js"
//
// (The emulators:exec wrapper starts the Firestore emulator, waits for it
// to be ready, runs the tests against it, then shuts it down — you don't
// need a emulator running in a separate terminal.)

import { readFileSync } from 'fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import {
  describe, it, beforeAll, afterAll, beforeEach,
} from 'vitest';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'aura-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

const asAlice = () => testEnv.authenticatedContext('alice').firestore();
const asBob = () => testEnv.authenticatedContext('bob').firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

describe('matchPairs — get-before-create', () => {
  it('lets a participant read a pair doc that does not exist yet', async () => {
    // This is the exact scenario that used to throw permission-denied:
    // requestMatch() does a getDoc() to check "does this pair exist" BEFORE
    // ever calling setDoc(). If this fails, nobody can ever send a first
    // match request.
    const pairId = 'alice_bob';
    await assertSucceeds(getDoc(doc(asAlice(), 'matchPairs', pairId)));
  });

  it('lets a participant create the pair once it does not exist', async () => {
    const pairId = 'alice_bob';
    await assertSucceeds(setDoc(doc(asAlice(), 'matchPairs', pairId), {
      userA: 'alice', userB: 'bob', status: 'pending', createdAt: Timestamp.now(),
    }));
  });

  it('blocks someone who is not a participant from creating the pair', async () => {
    await assertFails(setDoc(doc(asBob(), 'matchPairs', 'alice_carol'), {
      userA: 'alice', userB: 'carol', status: 'pending', createdAt: Timestamp.now(),
    }));
  });
});

describe('users — server-side age gate', () => {
  it('rejects an age below 16 even though the request is otherwise valid', async () => {
    await assertFails(setDoc(doc(asAlice(), 'users', 'alice'), {
      age: 15, gender: 'nonbinary', avatarColor: '#fff', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
  });

  it('accepts an age at or above 16', async () => {
    await assertSucceeds(setDoc(doc(asAlice(), 'users', 'alice'), {
      age: 16, gender: 'nonbinary', avatarColor: '#fff', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
  });

  it('rejects a non-integer age (e.g. a string, to rule out type-juggling tricks)', async () => {
    await assertFails(setDoc(doc(asAlice(), 'users', 'alice'), {
      age: '99', gender: 'nonbinary', avatarColor: '#fff', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
  });
});

describe('blocks — asymmetric, owner-only', () => {
  it('lets alice create her own block of bob', async () => {
    await assertSucceeds(setDoc(doc(asAlice(), 'blocks', 'alice_bob'), {
      blockerId: 'alice', blockedId: 'bob', createdAt: Timestamp.now(),
    }));
  });

  it('blocks alice from creating a block doc claiming to be bob', async () => {
    await assertFails(setDoc(doc(asAlice(), 'blocks', 'bob_alice'), {
      blockerId: 'bob', blockedId: 'alice', createdAt: Timestamp.now(),
    }));
  });

  it('blocks bob from reading a block row where alice is the blocker', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'blocks', 'alice_bob'), {
        blockerId: 'alice', blockedId: 'bob', createdAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(asBob(), 'blocks', 'alice_bob')));
  });

  it('lets alice delete (unblock) her own block row', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'blocks', 'alice_bob'), {
        blockerId: 'alice', blockedId: 'bob', createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(deleteDoc(doc(asAlice(), 'blocks', 'alice_bob')));
  });
});

describe('reports — write-only', () => {
  it('lets a signed-in user file a report about someone else', async () => {
    await assertSucceeds(setDoc(doc(asAlice(), 'reports', 'report1'), {
      reporterId: 'alice', reportedId: 'bob', reason: 'harassment', createdAt: Timestamp.now(),
    }));
  });

  it('rejects a report where reporterId does not match the caller', async () => {
    await assertFails(setDoc(doc(asAlice(), 'reports', 'report2'), {
      reporterId: 'mallory', reportedId: 'bob', reason: 'harassment', createdAt: Timestamp.now(),
    }));
  });

  it('rejects a report about yourself', async () => {
    await assertFails(setDoc(doc(asAlice(), 'reports', 'report3'), {
      reporterId: 'alice', reportedId: 'alice', reason: 'harassment', createdAt: Timestamp.now(),
    }));
  });

  it('never lets anyone read a report back, not even the reporter', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', 'report4'), {
        reporterId: 'alice', reportedId: 'bob', reason: 'harassment', createdAt: Timestamp.now(),
      });
    });
    await assertFails(getDoc(doc(asAlice(), 'reports', 'report4')));
  });
});

describe('unauthenticated access', () => {
  it('is denied everywhere', async () => {
    await assertFails(getDoc(doc(asAnon(), 'matchProfiles', 'anything')));
  });
});
