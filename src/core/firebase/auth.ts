import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { ensureFirebaseApp } from './config';

export interface SyncAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

function mapUser(user: User | null): SyncAuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/**
 * Optional Firebase Authentication (Google sign-in) used strictly for encrypted backup & sync (FR-FB-5, FR-SY-1).
 * Core Trailmind functionality works with zero sign-in.
 */
export class FirebaseAuthService {
  private auth: Auth | null = null;

  private getAuthInstance(): Auth {
    const { app, configured } = ensureFirebaseApp();
    if (!configured) {
      throw new Error(
        'Firebase is not configured in this build. Set VITE_FIREBASE_* environment variables to enable optional encrypted sync.',
      );
    }
    if (!this.auth) {
      this.auth = getAuth(app);
    }
    return this.auth;
  }

  getCurrentUser(): SyncAuthUser | null {
    if (!this.auth) return null;
    return mapUser(this.auth.currentUser);
  }

  onChange(callback: (user: SyncAuthUser | null) => void): () => void {
    const { configured } = ensureFirebaseApp();
    if (!configured) {
      callback(null);
      return () => undefined;
    }
    const auth = this.getAuthInstance();
    return onAuthStateChanged(auth, (u) => callback(mapUser(u)));
  }

  async signInWithGoogle(): Promise<SyncAuthUser> {
    const auth = this.getAuthInstance();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Prefer Chrome identity token when available in extension pages, otherwise popup auth
    const chromeIdentity = (globalThis as { chrome?: typeof chrome }).chrome?.identity;
    if (chromeIdentity?.getAuthToken) {
      try {
        const tokenResult = await new Promise<string>((resolve, reject) => {
          chromeIdentity.getAuthToken({ interactive: true }, (token) => {
            const err = chrome.runtime?.lastError;
            if (err || !token) {
              reject(new Error(err?.message ?? 'Chrome identity token unavailable'));
              return;
            }
            resolve(typeof token === 'string' ? token : String(token));
          });
        });
        const credential = GoogleAuthProvider.credential(null, tokenResult);
        const result = await signInWithCredential(auth, credential);
        const mapped = mapUser(result.user);
        if (!mapped) throw new Error('Sign-in completed without user profile');
        return mapped;
      } catch {
        // Fall through to Firebase Auth popup flow
      }
    }

    const result = await signInWithPopup(auth, provider);
    const mapped = mapUser(result.user);
    if (!mapped) throw new Error('Google sign-in failed');
    return mapped;
  }

  async signOutUser(): Promise<void> {
    const { configured } = ensureFirebaseApp();
    if (!configured) return;
    const auth = this.getAuthInstance();
    await signOut(auth);
  }
}

export const firebaseAuthService = new FirebaseAuthService();
