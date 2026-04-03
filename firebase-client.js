import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCus77pZp_rUNAJNaPThrcGavdXkkJSdF0",
  authDomain: "bolodemaejp.firebaseapp.com",
  projectId: "bolodemaejp",
  storageBucket: "bolodemaejp.firebasestorage.app",
  messagingSenderId: "18591522219",
  appId: "1:18591522219:web:a34f04b6dc8474ee4106ee",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

export { app, auth, db, googleProvider };
