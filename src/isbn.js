// Normalisation et validation des ISBN.
// Un code-barres mal lu produit un ISBN plausible mais faux ; verifier la cle
// de controle evite d'aller interroger les catalogues pour rien.

export const nettoyer = (saisie) => String(saisie ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();

export function cleIsbn10(corps9) {
  let somme = 0;
  for (let i = 0; i < 9; i++) somme += (10 - i) * Number(corps9[i]);
  const reste = (11 - (somme % 11)) % 11;
  return reste === 10 ? 'X' : String(reste);
}

export function cleIsbn13(corps12) {
  let somme = 0;
  for (let i = 0; i < 12; i++) somme += Number(corps12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (somme % 10)) % 10);
}

export function estValide(saisie) {
  const code = nettoyer(saisie);
  if (code.length === 10) return /^\d{9}[\dX]$/.test(code) && cleIsbn10(code) === code[9];
  if (code.length === 13) return /^\d{13}$/.test(code) && cleIsbn13(code) === code[12];
  return false;
}

export function versIsbn13(saisie) {
  const code = nettoyer(saisie);
  if (code.length === 13) return estValide(code) ? code : null;
  if (code.length === 10 && estValide(code)) {
    const corps = '978' + code.slice(0, 9);
    return corps + cleIsbn13(corps);
  }
  return null;
}

export function versIsbn10(saisie) {
  const code = versIsbn13(saisie);
  if (!code || !code.startsWith('978')) return null;
  const corps = code.slice(3, 12);
  return corps + cleIsbn10(corps);
}

export const formater = (saisie) => {
  const code = nettoyer(saisie);
  return code.length === 13
    ? `${code.slice(0, 3)}-${code.slice(3, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`
    : code;
};
