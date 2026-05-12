# ABAC Quick Start Guide

This guide helps you quickly implement attribute-based access control (ABAC) in your code.

## For Backend Developers

### 1. Set Custom Claims on User Registration

```python
from auth_claims import set_user_claims

@app.post("/api/auth/register")
async def register_user(request: RegisterRequest):
    # Create Firebase user
    user = firebase_auth.create_user(
        email=request.email,
        password=request.password
    )
    
    # Determine organization (from invite code, domain, etc.)
    org_id = determine_organization_from_invite(request.invite_code)
    
    # Set custom claims
    set_user_claims(user.uid, role='farmer', organization_id=org_id)
    
    return {"uid": user.uid, "organizationId": org_id}
```

### 2. Update Claims When Role/Org Changes

```python
from auth_claims import update_user_role, update_user_organization

@app.post("/api/admin/update-role")
async def update_role(request: Request, uid: str, new_role: str):
    # Verify admin
    token_data = await verify_role(request, required_roles=['admin'])
    
    # Update role
    update_user_role(uid, new_role)
    
    return {"success": True}

@app.post("/api/admin/move-user")
async def move_user(request: Request, uid: str, new_org_id: str):
    # Verify admin
    token_data = await verify_role(request, required_roles=['admin'])
    
    # Move user to new organization
    update_user_organization(uid, new_org_id)
    
    return {"success": True}
```

### 3. Verify Organization Access in API Endpoints

```python
@app.get("/api/reports/{report_id}")
async def get_report(request: Request, report_id: str):
    # Verify authentication
    token_data = await verify_role(request)
    uid = token_data["uid"]
    
    # Get report from Firestore
    report_doc = db_firestore.collection('reports').document(report_id).get()
    
    if not report_doc.exists:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report_data = report_doc.to_dict()
    
    # Check organization access (unless admin)
    if token_data["role"] != "admin":
        user_doc = db_firestore.collection('users').document(uid).get()
        user_org = user_doc.to_dict().get('organizationId')
        
        if report_data.get('organizationId') != user_org:
            raise HTTPException(status_code=403, detail="Access denied")
    
    return report_data
```

## For Frontend Developers

### 1. Initialize ABAC Helpers

```javascript
// In your main App.jsx or index.jsx
import { initABAC } from './lib/firestore-abac';

function App() {
  useEffect(() => {
    initABAC();
  }, []);
  
  // ... rest of your app
}
```

### 2. Create Documents with Organization

```javascript
import { createDocWithOrg } from './lib/firestore-abac';

async function createPost(content) {
  try {
    // Automatically includes userId, organizationId, and createdAt
    const docRef = await createDocWithOrg('posts', {
      content: content,
      likes: 0,
      commentsCount: 0
    });
    
    console.log('Post created:', docRef.id);
  } catch (error) {
    console.error('Error creating post:', error);
  }
}
```

### 3. Query Organization-Scoped Data

```javascript
import { queryOrgDocs, subscribeToOrgDocs } from './lib/firestore-abac';
import { orderBy, limit } from 'firebase/firestore';

// One-time query
async function loadPosts() {
  const snapshot = await queryOrgDocs('posts', [
    orderBy('createdAt', 'desc'),
    limit(20)
  ]);
  
  const posts = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  
  return posts;
}

// Real-time subscription
function subscribeToActivities(callback) {
  return subscribeToOrgDocs('activities', (snapshot) => {
    const activities = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(activities);
  }, [orderBy('date', 'desc')]);
}

// Usage in React
function ActivitiesList() {
  const [activities, setActivities] = useState([]);
  
  useEffect(() => {
    const unsubscribe = subscribeToActivities(setActivities);
    return unsubscribe; // Cleanup on unmount
  }, []);
  
  return (
    <div>
      {activities.map(activity => (
        <ActivityCard key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
```

### 4. Update Documents Safely

```javascript
import { updateDocSafe } from './lib/firestore-abac';

async function updatePost(postId, newContent) {
  try {
    // organizationId is automatically protected from changes
    await updateDocSafe('posts', postId, {
      content: newContent,
      // organizationId: 'different_org' // This would be ignored with a warning
    });
    
    console.log('Post updated');
  } catch (error) {
    console.error('Error updating post:', error);
  }
}
```

### 5. Check Access Before Showing UI

```javascript
import { canAccessDoc, getCurrentUserRole } from './lib/firestore-abac';

function PostActions({ postId, postOwnerId }) {
  const [canEdit, setCanEdit] = useState(false);
  const currentUser = auth.currentUser;
  
  useEffect(() => {
    async function checkAccess() {
      const hasAccess = await canAccessDoc('posts', postId);
      const role = await getCurrentUserRole();
      
      // User can edit if they own the post or are admin
      setCanEdit(hasAccess && (currentUser.uid === postOwnerId || role === 'admin'));
    }
    
    checkAccess();
  }, [postId, postOwnerId]);
  
  return (
    <div>
      {canEdit && (
        <>
          <button onClick={handleEdit}>Edit</button>
          <button onClick={handleDelete}>Delete</button>
        </>
      )}
    </div>
  );
}
```

### 6. Debug ABAC Context

```javascript
import { debugABACContext } from './lib/firestore-abac';

// In your browser console or during development
debugABACContext();

// Output:
// ABAC Context
//   User ID: abc123
//   Email: user@example.com
//   Organization ID: farm_001
//   Role: farmer
//   Token Claims: { role: 'farmer', organizationId: 'farm_001' }
//   Cache Status: { cached: true, age: 12345 }
```

## Common Patterns

### Pattern 1: User's Own Data

```javascript
import { queryUserDocs } from './lib/firestore-abac';

// Get all yield history for current user
const userYieldHistory = await queryUserDocs('yield_history', [
  orderBy('timestamp', 'desc')
]);
```

### Pattern 2: Organization-Wide Data

```javascript
import { queryOrgDocs } from './lib/firestore-abac';

// Get all posts in user's organization
const orgPosts = await queryOrgDocs('posts', [
  orderBy('createdAt', 'desc'),
  limit(50)
]);
```

### Pattern 3: Conditional Rendering Based on Role

```javascript
import { getCurrentUserRole } from './lib/firestore-abac';

function AdminPanel() {
  const [isAdmin, setIsAdmin] = useState(false);
  
  useEffect(() => {
    getCurrentUserRole().then(role => {
      setIsAdmin(role === 'admin');
    });
  }, []);
  
  if (!isAdmin) {
    return <div>Access denied</div>;
  }
  
  return <div>Admin controls...</div>;
}
```

## Migration Checklist

When migrating existing code:

- [ ] Replace `addDoc()` with `createDocWithOrg()`
- [ ] Replace `updateDoc()` with `updateDocSafe()`
- [ ] Add `where('organizationId', '==', orgId)` to existing queries
- [ ] Or use `queryOrgDocs()` helper instead
- [ ] Update user registration to set custom claims
- [ ] Run migration script to add organizationId to existing documents
- [ ] Deploy new Firestore rules
- [ ] Deploy Firestore indexes
- [ ] Test with multiple organizations

## Testing

### Test Organization Isolation

```javascript
// Create test users in different organizations
const user1 = { uid: 'user1', organizationId: 'org_a' };
const user2 = { uid: 'user2', organizationId: 'org_b' };

// User 1 creates a post
await createDocWithOrg('posts', { content: 'Hello from Org A' });

// User 2 should NOT see User 1's post
const user2Posts = await queryOrgDocs('posts');
expect(user2Posts.docs.length).toBe(0);
```

### Test Admin Access

```javascript
// Admin should see posts from all organizations
const adminUser = { uid: 'admin1', role: 'admin', organizationId: 'org_a' };

// Query as admin (use Firestore directly, not helper)
const allPosts = await getDocs(collection(db, 'posts'));
expect(allPosts.docs.length).toBeGreaterThan(0);
```

## Troubleshooting

### "User has no organization" Error

**Cause**: User's Firestore profile doesn't have `organizationId` field.

**Solution**: 
1. Check if custom claims are set: `debugABACContext()`
2. Run migration script: `python migration_add_org_id.py`
3. Ensure new users get organizationId on registration

### "Permission denied" on Firestore Operations

**Cause**: Firestore rules are blocking the operation.

**Solution**:
1. Check if document has `organizationId` field
2. Verify user's custom claims: `debugABACContext()`
3. Check Firestore rules match your use case
4. Look at Firebase Console > Firestore > Rules tab for detailed errors

### Stale Organization Data

**Cause**: Cache is outdated or custom claims not refreshed.

**Solution**:
```javascript
import { clearOrgCache } from './lib/firestore-abac';

// Force refresh
clearOrgCache();
const orgId = await getCurrentUserOrgId();

// Or force token refresh
await auth.currentUser.getIdToken(true);
```

## Best Practices

1. **Always use helpers**: Use `createDocWithOrg()` instead of raw `addDoc()`
2. **Never trust client data**: Always validate organizationId on backend
3. **Cache wisely**: The helper caches organizationId for 5 minutes
4. **Test isolation**: Always test that users can't access other orgs' data
5. **Audit regularly**: Enable Firestore audit logs to monitor access patterns
6. **Document ownership**: Every document should have clear ownership (userId + organizationId)

## Next Steps

- Read the full [ABAC Security Documentation](./FIRESTORE_ABAC_SECURITY.md)
- Review [Firestore Security Rules](../firestore.rules)
- Check [Migration Script](../migration_add_org_id.py)
- Test with [Security Rules Unit Tests](../tests/firestore-security.test.js)
