/**
 * normalizeText.ts
 *
 * One function to convert text to lower case and remove accentuation
 * E.g: "Olá" -> "ola"
 */

export const normalizeText = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

