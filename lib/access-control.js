import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { getAdminDocId } from "./store-utils";

function normalizeAccessData(userId, data = {}) {
  return {
    email: userId,
    displayName: data.displayName || "",
    photoURL: data.photoURL || "",
    isAdmin: data.isAdmin === true,
    canAccessCash: data.canAccessCash === true,
    disabled: data.disabled === true,
  };
}

export async function syncUserProfile(user) {
  const userId = getAdminDocId(user);
  if (!userId) return;

  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: userId,
      displayName: user?.displayName || "",
      photoURL: user?.photoURL || "",
      isAdmin: false,
      canAccessCash: false,
      disabled: false,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    return;
  }

  await setDoc(
    userRef,
    {
      displayName: user?.displayName || "",
      photoURL: user?.photoURL || "",
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getUserAccessProfile(user) {
  const userId = getAdminDocId(user);
  if (!userId) {
    return {
      exists: false,
      email: "",
      displayName: "",
      photoURL: "",
      isAdmin: false,
      canAccessCash: false,
      disabled: false,
      canAccessAdminPanel: false,
      canAccessCashPanel: false,
    };
  }

  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);
  const data = normalizeAccessData(userId, userSnap.data() || {});

  return {
    exists: userSnap.exists(),
    ...data,
    canAccessAdminPanel: userSnap.exists() && data.isAdmin && !data.disabled,
    canAccessCashPanel: userSnap.exists() && !data.disabled && (data.isAdmin || data.canAccessCash),
  };
}

export function subscribeToUserAccess(user, callback) {
  const userId = getAdminDocId(user);
  if (!userId) {
    callback({
      exists: false,
      email: "",
      displayName: "",
      photoURL: "",
      isAdmin: false,
      canAccessCash: false,
      disabled: false,
      canAccessAdminPanel: false,
      canAccessCashPanel: false,
    });
    return () => {};
  }

  const userRef = doc(db, "users", userId);

  return onSnapshot(userRef, (userSnap) => {
    const data = normalizeAccessData(userId, userSnap.data() || {});

    callback({
      exists: userSnap.exists(),
      ...data,
      canAccessAdminPanel: userSnap.exists() && data.isAdmin && !data.disabled,
      canAccessCashPanel: userSnap.exists() && !data.disabled && (data.isAdmin || data.canAccessCash),
    });
  });
}

export async function isAllowedAdmin(user) {
  const access = await getUserAccessProfile(user);
  return access.canAccessAdminPanel;
}

export async function isAllowedCashOperator(user) {
  const access = await getUserAccessProfile(user);
  return access.canAccessCashPanel;
}
