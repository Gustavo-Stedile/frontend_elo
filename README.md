# ELO — frontend

Frontend em JavaScript puro (módulos ES), sem build e sem dependências.

## Como rodar

1. Suba o backend (porta 8000):

   ```bash
   cd elo
   uvicorn main:app --reload
   ```

2. Sirva esta pasta em uma porta liberada no CORS do backend (`5173` ou `3000`):

   ```bash
   cd elo-frontend
   python -m http.server 5173
   ```

3. Abra http://localhost:5173

> Não abra o `index.html` com duplo clique (`file://`): módulos ES e CORS não funcionam assim.

Se a API estiver em outro endereço, use o link **alterar** na tela de login
(fica salvo no `localStorage`). Em outra origem, inclua-a em `allow_origins`
no `main.py`.

## Estrutura

```
index.html
css/style.css
js/api.js   # chamadas HTTP, token, tratamento de erros
js/ui.js    # helpers de DOM, diálogos, toasts
js/app.js   # estado, regras de tela e renderização
```

## O que tem

- Cadastro, login e logout (a sessão expira em 30 min no backend; o front volta ao login)
- Criar grêmio e alternar entre grêmios
- Canais: listar, criar, editar, excluir (conforme permissões)
- Chat: enviar, editar e apagar mensagens, paginar histórico, atualização por polling (3 s)
- Membros: listar, adicionar por ID, remover, atribuir/remover cargos
- Cargos: criar, editar, excluir, com permissões e prioridade
- A interface esconde ações para as quais o usuário não tem permissão; quem decide é sempre o servidor

## Limitações conhecidas

- O polling usa `depois_de`, então edições e exclusões feitas por **outras** pessoas só aparecem ao reabrir o canal.
- Sobrescritas de permissão por canal (`/canal/{id}/permissoes/...`) e permissões individuais por membro ainda não têm tela.
- Adicionar membro exige o ID numérico (mostrado abaixo do nome, no canto inferior esquerdo), pois a API não oferece busca de usuários.
