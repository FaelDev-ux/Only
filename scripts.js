import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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
const ordersCollection = collection(db, "orders");
const productsCollection = collection(db, "products");

const STORE_WHATSAPP = "5583999262555";
const SEND_TO_CUSTOMER = true;

const modal = document.getElementById("product-modal");
const modalTitle = document.getElementById("modal-title");
const modalPrice = document.getElementById("modal-price");
const modalDetails = document.getElementById("modal-details");
const modalPhoto = document.getElementById("modal-photo");
const modalAdd = document.getElementById("modal-add");
const cartPanel = document.getElementById("cart-panel");
const cartItems = document.getElementById("cart-items");
const cartCount = document.getElementById("cart-count");
const cartTotal = document.getElementById("cart-total");
const checkoutModal = document.getElementById("checkout-modal");
const checkoutForm = document.getElementById("checkout-form");
const menuContainer = document.getElementById("menu-container");

const cart = new Map();
let currentModalItem = null;
const CATEGORY_ORDER = [
  "Bolos Tradicionais",
  "Bolos Especiais",
  "Fatias",
  "Doces",
  "Sobremesas",
  "Bebidas",
];

const openModal = (button) => {
  modalTitle.textContent = button.dataset.title || "";
  modalPrice.textContent = button.dataset.price || "";
  modalDetails.textContent = button.dataset.details || "";

  currentModalItem = {
    title: button.dataset.title || "",
    price: button.dataset.price || "",
    image: button.dataset.image || "",
  };

  const img = button.dataset.image;
  if (img) {
    modalPhoto.style.backgroundImage = `url("${img}")`;
    modalPhoto.style.backgroundSize = "cover";
    modalPhoto.style.backgroundPosition = "center";
    modalPhoto.textContent = "";
  } else {
    modalPhoto.style.backgroundImage = "";
    modalPhoto.textContent = "";
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
};

const closeModal = () => {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
};

menuContainer.addEventListener("click", (event) => {
  const itemButton = event.target.closest(".item-button");
  if (itemButton) {
    openModal(itemButton);
    return;
  }
  const addButton = event.target.closest(".add-to-cart");
  if (addButton) {
    addToCart({
      title: addButton.dataset.title || "",
      price: addButton.dataset.price || "",
      image: addButton.dataset.image || "",
    });
  }
});

modal.addEventListener("click", (event) => {
  if (event.target.dataset.close === "true") {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("is-open")) {
    closeModal();
  }
});

const parsePrice = (priceText) => {
  const clean = priceText.replace("R$", "").trim().replace(".", "").replace(",", ".");
  const value = Number.parseFloat(clean);
  return Number.isNaN(value) ? 0 : value;
};

const formatPrice = (value) => {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
};

const formatDisplayPrice = (value) => {
  if (typeof value === "string" && value.includes("R$")) return value;
  const numberValue = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(numberValue)) return "R$ 0,00";
  return formatPrice(numberValue);
};

const onlyDigits = (value) => value.replace(/\D/g, "");

const maskCEP = (value) => {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const maskPhone = (value) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const isValidCEP = (cep) => onlyDigits(cep).length === 8;

const isValidPhone = (phone) => {
  const digits = onlyDigits(phone);
  return digits.length === 10 || digits.length === 11;
};

const fetchViaCEP = async (cep) => {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return null;
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.erro) return null;
  return data;
};

const addToCart = (item) => {
  if (!item.title) return;
  const existing = cart.get(item.title);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.set(item.title, { ...item, qty: 1 });
  }
  renderCart();
};

const updateQty = (title, delta) => {
  const item = cart.get(title);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart.delete(title);
  }
  renderCart();
};

const renderCart = () => {
  cartItems.innerHTML = "";
  let count = 0;
  let total = 0;

  cart.forEach((item) => {
    count += item.qty;
    total += parsePrice(item.price) * item.qty;

    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-thumb" style="background-image: ${item.image ? `url('${item.image}')` : "none"}"></div>
      <div>
        <div class="cart-item-title">${item.title}</div>
        <div class="cart-item-price">${item.price}</div>
        <div class="cart-item-controls">
          <button type="button" data-action="dec">-</button>
          <span>${item.qty}</span>
          <button type="button" data-action="inc">+</button>
          <button type="button" data-action="remove">remover</button>
        </div>
      </div>
    `;

    row.querySelector("[data-action='dec']").addEventListener("click", () => updateQty(item.title, -1));
    row.querySelector("[data-action='inc']").addEventListener("click", () => updateQty(item.title, 1));
    row.querySelector("[data-action='remove']").addEventListener("click", () => updateQty(item.title, -item.qty));
    cartItems.appendChild(row);
  });

  cartCount.textContent = count;
  cartTotal.textContent = formatPrice(total);
};

const renderProducts = (products) => {
  menuContainer.innerHTML = "";
  const grouped = new Map();

  products.forEach((product) => {
    const category = product.category || "Outros";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(product);
  });

  const categories = [
    ...CATEGORY_ORDER.filter((cat) => grouped.has(cat)),
    ...Array.from(grouped.keys()).filter((cat) => !CATEGORY_ORDER.includes(cat)),
  ];

  categories.forEach((category) => {
    const section = document.createElement("section");
    section.className = "menu-col";
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h2");
    title.textContent = category;

    const list = document.createElement("ul");
    list.className = "item-grid";

    grouped.get(category).forEach((product) => {
      const listItem = document.createElement("li");
      listItem.className = "menu-item";

      const priceText = formatDisplayPrice(product.price);
      const image = product.image || "";
      const details = product.details || "";

      listItem.innerHTML = `
        <button class="item-button" type="button" data-title="${product.title}" data-price="${priceText}" data-details="${details}" data-image="${image}">
          <div class="item-photo" data-label="Foto" style="${image ? `background-image:url('${image}'); background-size: cover; background-position: center;` : ""}"></div>
          <div class="item-info">
            <span>${product.title}</span>
            <span class="price">${priceText}</span>
          </div>
        </button>
        <button class="add-to-cart" type="button" data-title="${product.title}" data-price="${priceText}" data-image="${image}">Adicionar ao carrinho</button>
      `;

      list.appendChild(listItem);
    });

    card.appendChild(title);
    card.appendChild(list);
    section.appendChild(card);
    menuContainer.appendChild(section);
  });
};

const loadProducts = async () => {
  const snapshot = await getDocs(productsCollection);
  const products = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((product) => product.available === true);
  renderProducts(products);
};

document.getElementById("cart-open").addEventListener("click", () => {
  cartPanel.classList.add("is-open");
  cartPanel.setAttribute("aria-hidden", "false");
});

document.getElementById("cart-close").addEventListener("click", () => {
  cartPanel.classList.remove("is-open");
  cartPanel.setAttribute("aria-hidden", "true");
});

modalAdd.addEventListener("click", () => {
  if (currentModalItem) {
    addToCart(currentModalItem);
  }
});

renderCart();
loadProducts();

document.getElementById("cart-checkout").addEventListener("click", () => {
  if (cart.size === 0) {
    alert("Seu carrinho está vazio.");
    return;
  }
  checkoutModal.classList.add("is-open");
  checkoutModal.setAttribute("aria-hidden", "false");
});

checkoutModal.addEventListener("click", (event) => {
  if (event.target.dataset.close === "checkout") {
    checkoutModal.classList.remove("is-open");
    checkoutModal.setAttribute("aria-hidden", "true");
  }
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (cart.size === 0) {
    alert("Seu carrinho está vazio.");
    return;
  }

  checkoutForm.phone.value = maskPhone(checkoutForm.phone.value);
  checkoutForm.cep.value = maskCEP(checkoutForm.cep.value);

  if (!isValidPhone(checkoutForm.phone.value)) {
    alert("Telefone/WhatsApp inválido. Use DDD + número.");
    return;
  }

  if (!isValidCEP(checkoutForm.cep.value)) {
    alert("CEP inválido. Use 8 dígitos.");
    return;
  }

  const viaCepData = await fetchViaCEP(checkoutForm.cep.value);
  if (!viaCepData) {
    alert("CEP não encontrado. Verifique e tente novamente.");
    return;
  }

  const items = Array.from(cart.values()).map((item) => ({
    title: item.title,
    price: item.price,
    qty: item.qty,
    image: item.image || "",
  }));

  const totalValue = items.reduce(
    (sum, item) => sum + parsePrice(item.price) * item.qty,
    0
  );

  const customer = {
    name: checkoutForm.name.value.trim(),
    phone: checkoutForm.phone.value.trim(),
    payment: checkoutForm.payment.value,
    cep: checkoutForm.cep.value.trim(),
    address: checkoutForm.address.value.trim() || viaCepData.logradouro || "",
    district: checkoutForm.district.value.trim() || viaCepData.bairro || "",
    complement: checkoutForm.complement.value.trim(),
    notes: checkoutForm.notes.value.trim(),
    city: viaCepData.localidade || "",
    state: viaCepData.uf || "",
  };

  try {
    await addDoc(ordersCollection, {
      items,
      total: totalValue,
      customer,
      createdAt: serverTimestamp(),
    });
    cart.clear();
    renderCart();
    checkoutForm.reset();
    checkoutModal.classList.remove("is-open");
    checkoutModal.setAttribute("aria-hidden", "true");
    const messageLines = [
      "Novo pedido — Bolo de Mãe JP Confeitaria",
      "",
      "Itens:",
      ...items.map(
        (item) => `- ${item.qty}x ${item.title} (${item.price})`
      ),
      "",
      `Total: ${formatPrice(totalValue)}`,
      "",
      "Cliente:",
      `Nome: ${customer.name}`,
      `WhatsApp: ${customer.phone}`,
      `Pagamento: ${customer.payment}`,
      `Endereço: ${customer.address}, ${customer.district} - CEP ${customer.cep}`,
      `Cidade/UF: ${customer.city} - ${customer.state}`,
      `Complemento: ${customer.complement || "—"}`,
      `Observações: ${customer.notes || "—"}`,
    ];

    if (STORE_WHATSAPP) {
      const text = encodeURIComponent(messageLines.join("\n"));
      const target = onlyDigits(STORE_WHATSAPP);
      const storeUrl = `https://wa.me/${target}?text=${text}`;
      window.open(storeUrl, "_blank");

      if (SEND_TO_CUSTOMER && customer.phone) {
        const customerTarget = onlyDigits(customer.phone);
        const customerUrl = `https://wa.me/${customerTarget}?text=${text}`;
        window.open(customerUrl, "_blank");
      }
    } else {
      alert(
        "Pedido enviado com sucesso! Configure o número da loja em STORE_WHATSAPP para enviar no WhatsApp."
      );
    }
  } catch (error) {
    console.error(error);
    alert("Não foi possível enviar o pedido. Tente novamente.");
  }
});

checkoutForm.cep.addEventListener("input", (event) => {
  event.target.value = maskCEP(event.target.value);
});

checkoutForm.phone.addEventListener("input", (event) => {
  event.target.value = maskPhone(event.target.value);
});

checkoutForm.cep.addEventListener("blur", async () => {
  if (!isValidCEP(checkoutForm.cep.value)) return;
  const data = await fetchViaCEP(checkoutForm.cep.value);
  if (!data) return;
  if (!checkoutForm.address.value) {
    checkoutForm.address.value = data.logradouro || "";
  }
  if (!checkoutForm.district.value) {
    checkoutForm.district.value = data.bairro || "";
  }
});
