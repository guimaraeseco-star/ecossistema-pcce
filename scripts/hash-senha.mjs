/**
 * Gera o hash `pbkdf2v2` das senhas de BOOTSTRAP (`SUPER_ADMIN_SENHA` /
 * `ADMIN_GERAL_SENHA`), para que a credencial de break-glass não fique em
 * texto claro no painel do Cloudflare nem no `wrangler`.
 *
 * Uso:
 *   HASH_PASSWORD='SenhaForte' node scripts/hash-senha.mjs
 *   → pbkdf2v2:100000:<salt hex>:<hash hex>
 *
 * Cole a saída INTEIRA (com o prefixo) na variável de ambiente.
 * `verificarSenhaBootstrap` (`server/auth/auth-flow.ts`) aceita os dois
 * formatos — hash e texto claro —, e o hash é o recomendado.
 *
 * **Por que v2 e não v3**, que é o formato corrente das senhas de usuário: o
 * bootstrap é conferido SEM o `PASSWORD_PEPPER`, de propósito. É o que mantém a
 * conta root entrando mesmo no cenário em que o pepper foi perdido — e é o
 * cenário para o qual o break-glass existe.
 *
 * Os parâmetros abaixo espelham `src/lib/crypto/password-hash.ts`: PBKDF2-
 * HMAC-SHA256, 100 000 iterações (teto rígido da `crypto.subtle` do workerd),
 * salt de 16 bytes, saída de 32 bytes, tudo em hex. Mudar qualquer um deles
 * aqui produz um hash que o login recusa em silêncio — a verificação devolve
 * `false`, não erro.
 *
 * O `DEPLOY.md` apontava para um `scripts/hash-password.ts` que nunca foi
 * commitado (`git log --diff-filter=A` não acha). Quem seguia o runbook
 * travava no comando e o caminho fácil era deixar a senha em texto.
 */

const senha = process.env.HASH_PASSWORD;
if (!senha) {
	console.error("uso: HASH_PASSWORD='SuaSenhaForte' node scripts/hash-senha.mjs");
	process.exit(1);
}

/** Mesmo teto de `PBKDF2_V2_ITERATIONS` em src/lib/crypto/password-hash.ts. */
const ITERACOES = 100_000;

const salt = crypto.getRandomValues(new Uint8Array(16));
const material = await crypto.subtle.importKey(
	'raw',
	new TextEncoder().encode(senha),
	'PBKDF2',
	false,
	['deriveBits']
);
const bits = await crypto.subtle.deriveBits(
	{ name: 'PBKDF2', salt, iterations: ITERACOES, hash: 'SHA-256' },
	material,
	256
);

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

console.log(`pbkdf2v2:${ITERACOES}:${hex(salt)}:${hex(bits)}`);
