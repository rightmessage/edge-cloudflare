import tseslint from "typescript-eslint";
export default tseslint.config({ ignores: ["dist/**", "node_modules/**", "template/worker-configuration.d.ts", ".wrangler/**", ".fixtures/**"] }, ...tseslint.configs.recommended);
