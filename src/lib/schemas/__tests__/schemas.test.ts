import { describe, it, expect } from 'vitest';
import {
	policialSchema,
	policialUpdateSchema,
	escalaSchema,
	escalaPolicialSchema,
	loginSchema,
	alterarSenhaSchema,
	unidadeSchema
} from '../index';

describe('policialSchema', () => {
	it('aceita dados válidos', () => {
		const result = policialSchema.safeParse({
			nome: 'João Silva',
			matricula: '12345678',
			cargo: 'DPC',
			telefone: '85999999999',
			lotacao: 'ICÓ'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita nome vazio', () => {
		const result = policialSchema.safeParse({
			nome: '',
			matricula: '12345678',
			cargo: 'DPC'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita cargo inválido', () => {
		const result = policialSchema.safeParse({
			nome: 'João',
			matricula: '12345678',
			cargo: 'DELEGADO'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toContain('DPC');
		}
	});

	it('aplica defaults para telefone e lotacao', () => {
		const result = policialSchema.safeParse({
			nome: 'João',
			matricula: '123',
			cargo: 'OIP'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.telefone).toBe('');
			expect(result.data.lotacao).toBe('');
		}
	});
});

describe('policialUpdateSchema', () => {
	it('aceita campos parciais', () => {
		const result = policialUpdateSchema.safeParse({ nome: 'Novo Nome' });
		expect(result.success).toBe(true);
	});

	it('aceita objeto vazio', () => {
		const result = policialUpdateSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('aceita ativo como número', () => {
		const result = policialUpdateSchema.safeParse({ ativo: 0 });
		expect(result.success).toBe(true);
	});
});

describe('escalaSchema', () => {
	it('aceita dados válidos', () => {
		const result = escalaSchema.safeParse({
			titulo: 'ESCALA PLANTÃO',
			cidade: 'ICÓ',
			lotacao: 'ICÓ',
			data_inicio: '2026-01-01',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.hora_entrada).toBe('08');
			expect(result.data.hora_saida).toBe('08');
		}
	});

	it('rejeita título vazio', () => {
		const result = escalaSchema.safeParse({
			titulo: '',
			cidade: 'ICÓ',
			data_inicio: '2026-01-01',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita sem data_inicio', () => {
		const result = escalaSchema.safeParse({
			titulo: 'ESCALA',
			cidade: 'ICÓ',
			data_fim: '2026-01-02'
		});
		expect(result.success).toBe(false);
	});
});

describe('escalaPolicialSchema', () => {
	it('aceita dados válidos', () => {
		const result = escalaPolicialSchema.safeParse({
			policial_id: 1,
			data_plantao: '2026-01-01'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita sem policial_id', () => {
		const result = escalaPolicialSchema.safeParse({
			data_plantao: '2026-01-01'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita data_plantao vazia se fosse obrigatória, mas agora é opcional', () => {
		const result = escalaPolicialSchema.safeParse({
			policial_id: 1,
			data_plantao: ''
		});
		// No esquema atual, data_plantao é .optional(), então "" passa.
		// Se quisermos que falhe, o esquema deveria ter .min(1).
		expect(result.success).toBe(true);
	});
});

describe('loginSchema', () => {
	it('aceita dados válidos', () => {
		const result = loginSchema.safeParse({
			matricula: '12345678',
			senha: 'minhasenha'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tipo).toBe('policial');
		}
	});

	it('rejeita matrícula vazia', () => {
		const result = loginSchema.safeParse({
			matricula: '',
			senha: 'senha123'
		});
		expect(result.success).toBe(false);
	});

	it('aceita tipo admin', () => {
		const result = loginSchema.safeParse({
			matricula: 'admin',
			senha: 'admin123',
			tipo: 'admin'
		});
		expect(result.success).toBe(true);
	});
});

describe('alterarSenhaSchema', () => {
	it('aceita senha forte com 8+ caracteres', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'Segura1x'
		});
		expect(result.success).toBe(true);
	});

	it('aceita senha longa e complexa', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'MinhaSenhaForte123'
		});
		expect(result.success).toBe(true);
	});

	it('rejeita senha com menos de 8 caracteres', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'Abc1'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita senha sem letra maiúscula', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'apenasminuscula1'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita senha sem letra minúscula', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'APENASMAI1'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita senha sem número', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'SemNumero'
		});
		expect(result.success).toBe(false);
	});

	it('rejeita senhas comuns', () => {
		const comuns = ['12345678', 'admin123', 'password', 'qwerty12'];
		for (const senha of comuns) {
			const result = alterarSenhaSchema.safeParse({ nova_senha: senha });
			expect(result.success).toBe(false);
		}
	});

	it('rejeita expansão pós-I-6 da blocklist (institucional + top breach)', () => {
		// Amostra do conjunto expandido — não tenta cobrir tudo, só garantir
		// que as categorias chave estão ativas:
		const amostra = [
			'Password123', // top breach com variação capitalizada
			'Policial2024', // vocabulário institucional + ano
			'Delegado2025',
			'Plantao2024',
			'Admin2026',
			'Iloveyou1', // rockyou clássico
			'Qwerty123',
			'00000000',
			'11223344'
		];
		for (const senha of amostra) {
			const result = alterarSenhaSchema.safeParse({ nova_senha: senha });
			expect(result.success, `senha "${senha}" deveria ser bloqueada`).toBe(false);
		}
	});

	it('aceita senha_atual opcional', () => {
		const result = alterarSenhaSchema.safeParse({
			nova_senha: 'Segura1x',
			senha_atual: 'Antiga1x'
		});
		expect(result.success).toBe(true);
	});
});

describe('unidadeSchema', () => {
	it('aceita nome válido', () => {
		const result = unidadeSchema.safeParse({ nome: 'ICÓ', cidade: 'ICÓ' });
		expect(result.success).toBe(true);
	});

	it('faz trim do nome', () => {
		const result = unidadeSchema.safeParse({ nome: '  ICÓ  ', cidade: 'ICÓ' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.nome).toBe('ICÓ');
		}
	});

	it('rejeita nome vazio', () => {
		const result = unidadeSchema.safeParse({ nome: '' });
		expect(result.success).toBe(false);
	});

	it('ficha: campos ausentes caem nos padrões (o modal de cadastro não os envia)', () => {
		const r = unidadeSchema.safeParse({ nome: 'DP de Icó' });
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.data).toMatchObject({
				endereco: '',
				telefone: '',
				email: '',
				ais: '',
				xadrezes: 0,
				tira_gravame: false,
				foto_url: null
			});
		}
	});

	it('ficha: e-mail vazio vale, e-mail inválido não; link da foto exige http e vira null quando vazio', () => {
		expect(unidadeSchema.safeParse({ nome: 'x', email: '' }).success).toBe(true);
		expect(unidadeSchema.safeParse({ nome: 'x', email: 'sem-arroba' }).success).toBe(false);
		expect(unidadeSchema.safeParse({ nome: 'x', email: ' dp@pc.ce.gov.br ' }).success).toBe(true);
		expect(unidadeSchema.safeParse({ nome: 'x', foto_url: 'drive.google.com/x' }).success).toBe(
			false
		);
		const ok = unidadeSchema.safeParse({ nome: 'x', foto_url: ' https://drive.google.com/x ' });
		expect(ok.success && ok.data.foto_url).toBe('https://drive.google.com/x');
		const vazio = unidadeSchema.safeParse({ nome: 'x', foto_url: '  ' });
		expect(vazio.success && vazio.data.foto_url).toBeNull();
	});

	it('ficha: xadrezes é inteiro de 0 a 99', () => {
		expect(unidadeSchema.safeParse({ nome: 'x', xadrezes: 3 }).success).toBe(true);
		expect(unidadeSchema.safeParse({ nome: 'x', xadrezes: -1 }).success).toBe(false);
		expect(unidadeSchema.safeParse({ nome: 'x', xadrezes: 100 }).success).toBe(false);
		expect(unidadeSchema.safeParse({ nome: 'x', xadrezes: 1.5 }).success).toBe(false);
	});
});
