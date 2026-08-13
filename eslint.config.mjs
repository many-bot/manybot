import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "whatsmeow-service/**"] },
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-cycle": ["error", { maxDepth: Infinity, ignoreExternal: true }],
      "import-x/no-unresolved": "off",
      "no-undef": "off",
      "no-empty": "off",
      "prefer-const": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off"
    }
  }
);
