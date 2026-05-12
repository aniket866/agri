/**
 * Firestore ABAC (Attribute-Based Access Control) Helper
 * 
 * This module provides utilities for working with organization-scoped
 * Firestore documents in a multi-tenant environment.
 * 
 * Key features:
 * - Automatic organizationId injection on document creation
 * - Caching of user's organizationId to reduce Firestore reads
 * - Helper functions for querying organization-scoped data
 * - Type-safe wrappers around Firestore operations
 */

import { 
  collection, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './firebase';

// Cache for user's organizationId
let cachedOrgId = null;
let cacheTimestamp = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear the organizationId cache.
 * Call this when user signs out or their organization changes.
 */
export function clearOrgCache() {
  cachedOrgId = null;
  cacheTimestamp = null;
}

/**
 * Get the current user's organizationId.
 * 
 * This function checks multiple sources in order:
 * 1. In-memory cache (fastest)
 * 2. Auth token custom claims (fast, no Firestore read)
 * 3. Firestore user profile (fallback)
 * 
 * @returns {Promise<string|null>} The user's organizationId or null
 * @throws {Error} If user is not authenticated
 */
export async function getCurrentUserOrgId() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  // Check cache first
  if (cachedOrgId && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedOrgId;
  }
  
  try {
    // Try to get from token claims (no Firestore read)
    const token = await user.getIdTokenResult();
    if (token.claims.organizationId) {
      cachedOrgId = token.claims.organizationId;
      cacheTimestamp = Date.now();
      return cachedOrgId;
    }
    
    // Fallback to Firestore profile
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      cachedOrgId = userDoc.data()?.organizationId || null;
      cacheTimestamp = Date.now();
      return cachedOrgId;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user organizationId:', error);
    throw error;
  }
}

/**
 * Get the current user's role.
 * 
 * @returns {Promise<string>} The user's role (defaults to 'farmer')
 */
export async function getCurrentUserRole() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  try {
    // Try token claims first
    const token = await user.getIdTokenResult();
    if (token.claims.role) {
      return token.claims.role;
    }
    
    // Fallback to Firestore
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      return userDoc.data()?.role || 'farmer';
    }
    
    return 'farmer';
  } catch (error) {
    console.error('Error getting user role:', error);
    return 'farmer';
  }
}

/**
 * Create a document with automatic organizationId injection.
 * 
 * @param {string} collectionName - Name of the collection
 * @param {Object} data - Document data
 * @returns {Promise<DocumentReference>} Reference to the created document
 */
export async function createDocWithOrg(collectionName, data) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  const orgId = await getCurrentUserOrgId();
  
  const docData = {
    ...data,
    userId: user.uid,
    organizationId: orgId,
    createdAt: serverTimestamp()
  };
  
  return addDoc(collection(db, collectionName), docData);
}

/**
 * Update a document, ensuring organizationId is not changed.
 * 
 * @param {string} collectionName - Name of the collection
 * @param {string} docId - Document ID
 * @param {Object} data - Data to update
 * @returns {Promise<void>}
 */
export async function updateDocSafe(collectionName, docId, data) {
  // Remove organizationId from update data to prevent accidental changes
  const { organizationId, ...safeData } = data;
  
  if (organizationId) {
    console.warn('Attempted to update organizationId - this field is immutable');
  }
  
  const docRef = doc(db, collectionName, docId);
  return updateDoc(docRef, {
    ...safeData,
    updatedAt: serverTimestamp()
  });
}

/**
 * Query documents in the user's organization.
 * 
 * @param {string} collectionName - Name of the collection
 * @param {Array} additionalConstraints - Additional query constraints (optional)
 * @returns {Promise<QuerySnapshot>} Query results
 */
export async function queryOrgDocs(collectionName, additionalConstraints = []) {
  const orgId = await getCurrentUserOrgId();
  
  if (!orgId) {
    throw new Error('User has no organization');
  }
  
  const q = query(
    collection(db, collectionName),
    where('organizationId', '==', orgId),
    ...additionalConstraints
  );
  
  return getDocs(q);
}

/**
 * Subscribe to documents in the user's organization.
 * 
 * @param {string} collectionName - Name of the collection
 * @param {Function} callback - Callback function for snapshot updates
 * @param {Array} additionalConstraints - Additional query constraints (optional)
 * @returns {Promise<Function>} Unsubscribe function
 */
export async function subscribeToOrgDocs(collectionName, callback, additionalConstraints = []) {
  const orgId = await getCurrentUserOrgId();
  
  if (!orgId) {
    throw new Error('User has no organization');
  }
  
  const q = query(
    collection(db, collectionName),
    where('organizationId', '==', orgId),
    ...additionalConstraints
  );
  
  return onSnapshot(q, callback);
}

/**
 * Check if the current user can access a document.
 * 
 * @param {string} collectionName - Name of the collection
 * @param {string} docId - Document ID
 * @returns {Promise<boolean>} True if user can access the document
 */
export async function canAccessDoc(collectionName, docId) {
  try {
    const user = auth.currentUser;
    if (!user) return false;
    
    const docRef = doc(db, collectionName, docId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) return false;
    
    const docData = docSnap.data();
    const userOrgId = await getCurrentUserOrgId();
    const userRole = await getCurrentUserRole();
    
    // Admins can access everything
    if (userRole === 'admin') return true;
    
    // Check if document belongs to user's organization
    if (docData.organizationId === userOrgId) return true;
    
    // Check if user owns the document
    if (docData.userId === user.uid) return true;
    
    return false;
  } catch (error) {
    console.error('Error checking document access:', error);
    return false;
  }
}

/**
 * Get user's own documents (regardless of organization).
 * 
 * @param {string} collectionName - Name of the collection
 * @param {Array} additionalConstraints - Additional query constraints (optional)
 * @returns {Promise<QuerySnapshot>} Query results
 */
export async function queryUserDocs(collectionName, additionalConstraints = []) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  
  const q = query(
    collection(db, collectionName),
    where('userId', '==', user.uid),
    ...additionalConstraints
  );
  
  return getDocs(q);
}

/**
 * Initialize ABAC helpers.
 * Call this when the app starts and when auth state changes.
 */
export function initABAC() {
  // Clear cache on auth state change
  auth.onAuthStateChanged((user) => {
    if (!user) {
      clearOrgCache();
    }
  });
  
  // Pre-fetch organizationId for authenticated users
  if (auth.currentUser) {
    getCurrentUserOrgId().catch(console.error);
  }
}

/**
 * Validate that a document has the required ABAC fields.
 * 
 * @param {Object} data - Document data to validate
 * @returns {Object} Validation result with { valid: boolean, errors: string[] }
 */
export function validateABACFields(data) {
  const errors = [];
  
  if (!data.userId) {
    errors.push('Missing required field: userId');
  }
  
  if (!data.organizationId) {
    errors.push('Missing required field: organizationId');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Debug helper: Log current user's ABAC context.
 */
export async function debugABACContext() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.log('ABAC Context: No user authenticated');
      return;
    }
    
    const orgId = await getCurrentUserOrgId();
    const role = await getCurrentUserRole();
    const token = await user.getIdTokenResult();
    
    console.group('ABAC Context');
    console.log('User ID:', user.uid);
    console.log('Email:', user.email);
    console.log('Organization ID:', orgId);
    console.log('Role:', role);
    console.log('Token Claims:', token.claims);
    console.log('Cache Status:', {
      cached: !!cachedOrgId,
      age: cacheTimestamp ? Date.now() - cacheTimestamp : null
    });
    console.groupEnd();
  } catch (error) {
    console.error('Error getting ABAC context:', error);
  }
}

// Export all functions
export default {
  getCurrentUserOrgId,
  getCurrentUserRole,
  createDocWithOrg,
  updateDocSafe,
  queryOrgDocs,
  subscribeToOrgDocs,
  canAccessDoc,
  queryUserDocs,
  clearOrgCache,
  initABAC,
  validateABACFields,
  debugABACContext
};
