import {
  APPWRITE_COLLECTIONS,
  Query as AppwriteQuery,
  databases,
  databaseId,
  listCollection,
  ownerPermissions,
  subscribeToCollection,
  upsertDocument,
  requireAppwrite,
} from './appwriteClient';

const DELETE_FIELD = Symbol('deleteField');
const collectionId = (name) => APPWRITE_COLLECTIONS[name] || name;
const normalize = (value) => value?.toDate ? value.toDate() : value;

export const Timestamp = {
  now: () => new Date(),
  fromDate: (date) => date,
};
export const serverTimestamp = () => new Date();

export async function runTransaction(_db, callback) {
  const transaction = {
    async get(reference) { return getDoc(reference); },
    set(reference, data, options) { return setDoc(reference, data, options); },
    update(reference, data) { return updateDoc(reference, data); },
    delete(reference) { return deleteDoc(reference); },
  };
  return callback(transaction);
}

export function collection(_db, name, ...path) {
  const collectionName = [name, ...path.filter(Boolean)].join('_');
  return { collectionId: collectionId(collectionName), name: collectionName, path };
}
export function doc(_db, name, ...segments) {
  const id = segments.pop();
  const collectionName = [name, ...segments.filter(Boolean)].join('_');
  return { collectionId: collectionId(collectionName), name: collectionName, id, path: segments };
}
export function where(field, operator, value) { return { type: 'where', field, operator, value }; }
export function orderBy(field, direction = 'asc') { return { type: 'orderBy', field, direction }; }
export function limit(value) { return { type: 'limit', value }; }
export function query(reference, ...constraints) { return { ...reference, constraints }; }

function toQueries(constraints = []) {
  return constraints.flatMap((constraint) => {
    if (constraint.type === 'where') {
      const operator = { '==': 'equal', '>': 'greaterThan', '>=': 'greaterThanEqual', '<': 'lessThan', '<=': 'lessThanEqual' }[constraint.operator];
      return operator ? [AppwriteQuery[operator](constraint.field, constraint.value)] : [];
    }
    if (constraint.type === 'orderBy') return [AppwriteQuery.orderAsc(constraint.field)];
    if (constraint.type === 'limit') return [AppwriteQuery.limit(constraint.value)];
    return [];
  });
}

function snapshot(document) {
  const data = document?.data || {};
  return { id: document.$id, exists: () => Boolean(document), data: () => data, ref: document.$id };
}
function querySnapshot(result) {
  const docs = (result.documents || []).map(snapshot);
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (callback) => docs.forEach(callback) };
}

export async function getDoc(reference) {
  requireAppwrite();
  try { return snapshot(await databases.getDocument(databaseId, reference.collectionId, reference.id)); }
  catch (error) { if (error?.code === 404) return snapshot(null); throw error; }
}
export async function getDocs(reference) {
  return querySnapshot(await listCollection(reference.collectionId, toQueries(reference.constraints)));
}
export async function setDoc(reference, data, options = {}) {
  const payload = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== DELETE_FIELD).map(([key, value]) => [key, normalize(value)]));
  const existing = await getDoc(reference);
  const merged = options.merge && existing.exists() ? { ...existing.data(), ...payload } : payload;
  return upsertDocument(reference.collectionId, reference.id, merged, ownerPermissions(payload.uid || reference.id));
}
export async function updateDoc(reference, data) {
  const existing = await getDoc(reference);
  if (!existing.exists()) throw new Error('Document does not exist');
  const payload = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== DELETE_FIELD).map(([key, value]) => [key, normalize(value)]));
  for (const [key, value] of Object.entries(data)) if (value === DELETE_FIELD) delete existing.data()[key];
  return upsertDocument(reference.collectionId, reference.id, { ...existing.data(), ...payload }, ownerPermissions(existing.data().uid || reference.id));
}
export async function addDoc(reference, data) {
  const id = crypto.randomUUID();
  return setDoc({ ...reference, id }, data);
}
export async function deleteDoc(reference) {
  requireAppwrite();
  return databases.deleteDocument(databaseId, reference.collectionId, reference.id);
}
export function deleteField() { return DELETE_FIELD; }
export function increment(amount) { return amount; }

export function writeBatch() {
  const operations = [];
  return {
    update(reference, data) { operations.push(() => updateDoc(reference, data)); },
    set(reference, data, options) { operations.push(() => setDoc(reference, data, options)); },
    delete(reference) { operations.push(() => deleteDoc(reference)); },
    async commit() { return Promise.all(operations.map((operation) => operation())); },
  };
}

export function onSnapshot(reference, onNext, onError) {
  let active = true;
  const load = () => getDocs(reference).then((value) => active && onNext(value)).catch(onError);
  load();
  const unsubscribe = subscribeToCollection(reference.collectionId, toQueries(reference.constraints), onNext, onError);
  return () => { active = false; unsubscribe?.(); };
}
export { databases, databaseId };
export const db = {};
export const auth = {};
export default db;
