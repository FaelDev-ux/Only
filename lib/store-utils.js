export const STORE_WHATSAPP = "5583986088234";
export const SEND_TO_CUSTOMER = true;

export const CATEGORY_ORDER = [
  "Bolos Tradicionais",
  "Bolos Especiais",
  "Fatias",
  "Doces",
  "Sobremesas",
  "Bebidas",
  "Salgados",
];

export function parsePrice(priceText) {
  const clean = String(priceText).replace("R$", "").trim().replace(".", "").replace(",", ".");
  const value = Number.parseFloat(clean);
  return Number.isNaN(value) ? 0 : value;
}

export function formatPrice(value) {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function formatDisplayPrice(value) {
  if (typeof value === "string" && value.includes("R$")) return value;
  const numberValue = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(numberValue)) return "R$ 0,00";
  return formatPrice(numberValue);
}

export function generateOrderCode() {
  const timePart = Date.now().toString(36).slice(-5).toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${timePart}${randomPart}`;
}

export function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function maskCEP(value) {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function maskPhone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function isValidCEP(cep) {
  return onlyDigits(cep).length === 8;
}

export function isValidPhone(phone) {
  const digits = onlyDigits(phone);
  return digits.length === 10 || digits.length === 11;
}

export async function fetchViaCEP(cep) {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return null;

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) return null;

  const data = await response.json();
  if (data.erro) return null;
  return data;
}

export function buildGroupedProducts(products) {
  const grouped = new Map();

  products.forEach((product) => {
    const category = product.category || "Outros";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(product);
  });

  return [
    ...CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => ({
      category,
      products: grouped.get(category),
    })),
    ...Array.from(grouped.keys())
      .filter((category) => !CATEGORY_ORDER.includes(category))
      .map((category) => ({
        category,
        products: grouped.get(category),
      })),
  ];
}

export function describePublicAuthError(error) {
  const code = error?.code || "auth/unknown";

  if (code === "auth/popup-blocked") {
    return "Não conseguimos abrir o login agora. Tente novamente em instantes.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "O login não foi concluído. Tente novamente quando quiser.";
  }

  if (code === "auth/unauthorized-domain") {
    return "Não foi possível concluir o acesso agora. Tente novamente mais tarde.";
  }

  return "Não foi possível entrar agora. Tente novamente em alguns instantes.";
}

export function describeAdminAuthError(error) {
  const code = error?.code || "auth/unknown";

  if (code === "auth/unauthorized-domain") {
    return "Domínio não autorizado no Firebase. Adicione este domínio em Authentication > Settings > Authorized domains.";
  }

  if (code === "auth/operation-not-allowed") {
    return "Login com Google não está habilitado corretamente no Firebase Authentication.";
  }

  if (code === "auth/popup-blocked") {
    return "O navegador bloqueou o popup de login. Libere popups para este site.";
  }

  if (code === "auth/popup-closed-by-user") {
    return "A janela de login foi fechada antes da autenticação terminar.";
  }

  if (code === "auth/cancelled-popup-request") {
    return "Houve mais de uma tentativa de abrir o popup ao mesmo tempo.";
  }

  return `Não foi possível entrar com Google. Código: ${code}`;
}

export function getAdminDocId(user) {
  return user?.email?.trim() || "";
}
