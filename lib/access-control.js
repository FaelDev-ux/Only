import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { getAdminDocId } from "./store-utils";

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

export async function isAllowedAdmin(user) {
  const userId = getAdminDocId(user);
  if (!userId) return false;

  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);
  const data = userSnap.data() || {};

  return userSnap.exists() && data.isAdmin === true;
}
