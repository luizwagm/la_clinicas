# Subir o LA Clínicas no servidor (Hetzner) — passo a passo

**Um repositório, dois serviços:** o sistema da clínica (raiz do projeto) e o
site de vendas (pasta `site/`). O git, o clone e o `deploy.sh` são um só; cada
um roda no seu processo, com o seu endereço — o site é vitrine pública e não
lê segredo nenhum; o sistema guarda prontuário. Os passos 1 a 8 sobem o
sistema e já levam o site para `/site/` (passo 9).

Do código no seu computador ao primeiro login em
`https://laclinicas.projetos.luizaugust.me/restrito/`.

Cada passo tem como **conferir** antes do próximo. Se um deles não der o
resultado descrito, pare ali — o erro só fica mais caro depois.

> As senhas (do Postgres e a chave dos dados) são digitadas **por você**, no
> seu terminal. Elas não aparecem em arquivo versionado nenhum.

| | |
|---|---|
| Servidor | Hetzner · `204.168.208.52` · usuário `deploy` |
| Pasta | `/var/www/projetos/LA-Clinicas` |
| Serviço | `laclinicas.service` · porta **5204** (só em 127.0.0.1) |
| Site de vendas | `laclinicas-site.service` · porta **5213** · pasta `site/` |
| Banco | PostgreSQL `laclinicas_gestao`, papel `laclinicas` |
| Segredos | `/etc/laclinicas.env` (640 root:deploy) |

---

## Dados da clínica (desde a 0.4.0)

Nome, especialidades, CNPJ, WhatsApp, e-mail, site e cidade **não estão no código**:
cada instalação preenche os seus em **menu da conta → Dados da clínica** (só o
administrador). Eles saem no timbre de todas as impressões, no topo do sistema, no
login e na página do paciente (o WhatsApp vira o botão "Falar com a clínica").
Até serem preenchidos, aparece o neutro "Sua Clínica", sem CNPJ e sem botão.

Primeiro boot (desde a 0.5.0) semeia: o administrador, **50 convênios** (Particular,
operadoras nacionais, autogestões, odontológicos, cartões) e o **catálogo de 258
procedimentos** em 13 áreas, com cor, duração e anamnese — tudo ATIVO. Na implantação a
clínica **desativa** o que não usa (menu ⋮ da linha, filtro "Situação"). **Profissionais e
salas não são semeados**: são cadastrados na implantação. Valor dos procedimentos e
registro ANS dos convênios vêm em branco.

---

## 1. No seu computador: versionar e mandar para o GitHub

O repositório tem de ser **privado** — é o código de um produto, e o histórico
do git não esquece nada.

```powershell
cd C:\Projects\SitesProjects\LA-Clinicas
git add -A
git commit -m "LA Clínicas 0.5.0 + site de vendas 1.2.0 — identidade própria, dados da clínica, catálogo inicial, kit de produção"
gh repo create luizwagm/la_clinicas --private --source . --push
```

(Sem o `gh`: crie o repositório privado `la_clinicas` pelo site do GitHub e
rode `git remote add origin git@github.com:luizwagm/la_clinicas.git` e
`git push -u origin main`.)

**Conferir:** a página do repositório mostra o cadeado de privado, e **não**
tem `.env` nem a pasta `restrito/arquivos/` (estão no `.gitignore`).

---

## 2. DNS: o endereço apontando para o servidor

No painel onde está o DNS de `luizaugust.me`, crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `laclinicas.projetos` | `204.168.208.52` |

Sem proxy (nuvem cinza, se for Cloudflare) — o proxy intercepta o desafio do
certificado.

**Conferir** (pode levar alguns minutos):

```powershell
Resolve-DnsName laclinicas.projetos.luizaugust.me -Type A
```

Tem de devolver `204.168.208.52`.

> Sob `*.projetos.luizaugust.me` o navegador **recusa** `http://` (HSTS do
> domínio-pai). Não existe "abrir em HTTP enquanto o certificado não sai": o
> endereço só abre no navegador depois do passo 6.

---

## 3. No servidor: a porta está livre?

```bash
ssh deploy@204.168.208.52
ss -ltn | grep ':5204 ' || echo "5204 livre"
```

O servidor tem serviços que não existem no seu computador (a Riacho Solar na
5196, por exemplo). Se a 5204 estiver ocupada, use outra no passo 6 com
`--porta 5214`. O instalador também confere isso e para se estiver ocupada.

---

## 4. Trazer o código (chave de deploy, só leitura)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/la_clinicas -N "" -C "deploy@hetzner la_clinicas"
cat ~/.ssh/la_clinicas.pub
```

Cole a chave em **GitHub → la_clinicas → Settings → Deploy keys → Add deploy
key** (deixe **sem** "Allow write access").

```bash
cat >> ~/.ssh/config <<'CFG'

Host github-laclinicas
    HostName github.com
    User git
    IdentityFile ~/.ssh/la_clinicas
    IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config

git clone git@github-laclinicas:luizwagm/la_clinicas.git /var/www/projetos/LA-Clinicas
```

**Conferir:**

```bash
cd /var/www/projetos/LA-Clinicas && git log -1 --oneline   # o commit do passo 1
file deploy.sh nginx/criar-site.sh                          # sem "CRLF"
```

---

## 5. Banco e segredos

O Postgres já roda neste servidor (BemEstar, Kenósis). Crie o papel — a senha
é pedida no terminal e não fica em arquivo — e o banco:

```bash
sudo -u postgres createuser --pwprompt laclinicas
sudo -u postgres createdb -O laclinicas -E UTF8 -T template0 laclinicas_gestao
sudo -u postgres psql -c "REVOKE ALL ON DATABASE laclinicas_gestao FROM PUBLIC"
```

Agora o arquivo de segredos. A chave dos dados é **gerada aqui**, nova — não
reaproveite a do `.env` do seu computador:

```bash
sudo install -o root -g deploy -m 640 /dev/null /etc/laclinicas.env
echo "DADOS_CHAVE=$(openssl rand -base64 32)" | sudo tee -a /etc/laclinicas.env >/dev/null
sudo nano /etc/laclinicas.env        # acrescente a linha:  PGPASSWORD=<a senha que você digitou acima>
```

> **`DADOS_CHAVE` perdida é prontuário perdido para sempre** — CPF, anamnese e
> evolução ficam cifrados com ela, e nem o backup salva sem a chave. Copie agora
> para o seu gerenciador de senhas: `sudo cat /etc/laclinicas.env`

**Conferir:**

```bash
sudo stat -c '%a %U:%G' /etc/laclinicas.env     # 640 root:deploy
sudo grep -c . /etc/laclinicas.env              # 2
```

As outras variáveis (`PGUSER=laclinicas`, `PGDATABASE=laclinicas_gestao`,
`PGHOST=127.0.0.1`, `TZ=America/Recife`) já são o padrão do código.

---

## 6. Instalar (systemd + nginx + certificado)

```bash
cd /var/www/projetos/LA-Clinicas
sudo bash nginx/criar-site.sh laclinicas.projetos.luizaugust.me
```

O instalador, em ordem: confere programas, porta e segredos → **testa o login
no banco** com as credenciais do serviço → `npm ci` → instala e sobe a unit e
**espera o sistema ficar pronto** (as 10 migrations rodam no primeiro boot) →
nginx provisório → ensaia o desafio e emite o certificado → nginx definitivo →
confere.

O fim tem de mostrar, todas com o esperado:

```
o sistema                   200     página do paciente     200
código fonte pela web       404     regras pela web        404
credenciais pela web        404     anexo sem login        403
https://laclinicas.projetos.luizaugust.me/restrito/   200
Pronto.
```

Se parar em algum passo, a mensagem diz qual e o que fazer. Rodar de novo
depois de corrigir não faz mal.

---

## 7. Primeiro acesso

Abra `https://laclinicas.projetos.luizaugust.me/restrito/` e entre com
`admin` / `laclinicas-gestao`.

**Troque essa senha agora** (Usuários do sistema) — ela está escrita no
repositório. Depois crie os usuários reais pela tela.

Em seguida, **Dados da clínica** (menu da conta): sem isso as impressões saem
com "Sua Clínica" e sem CNPJ. Depois: cadastrar **salas** e **profissionais**, e
**desativar** os procedimentos e convênios que a clínica não atende.

**Conferir:** "Sobre o sistema" mostra a versão **0.5.0**, e

```bash
journalctl -u laclinicas -n 30 --no-pager | grep "sistema de gestão v"    # v0.5.0
```

---

## 8. Backup

- **Automático:** o LA Backup (timer `la-backup`, 04:00) descobre os bancos
  pelo catálogo do Postgres — o `laclinicas_gestao` entra sozinho na cópia
  cifrada para o R2. **Confira no dia seguinte**:
  `sudo journalctl -u la-backup --since today --no-pager | grep -i laclinicas`
- **Sob demanda:** botão "Backup do banco" dentro do sistema (administrador).
- **Antes de cada atualização:** o `deploy.sh` faz um `pg_dump` em `backups/` e
  **não atualiza** se ele falhar.

Backup nunca restaurado não é backup. Uma vez, num banco descartável:

```bash
sudo -u postgres createdb laclinicas_teste_restauro
sudo -u postgres psql -q -d laclinicas_teste_restauro -f backups/<arquivo>.sql
sudo -u postgres psql -d laclinicas_teste_restauro -c 'SELECT COUNT(*) FROM g_usuarios'
sudo -u postgres dropdb laclinicas_teste_restauro
```

---

## 9. Site de vendas

O passo 6 já instalou: o site abre em
**`https://laclinicas.projetos.luizaugust.me/site/`** (serviço `laclinicas-site`, porta
5213, sem banco e sem segredo). O fim do instalador mostra `site de vendas 200` e a
linha `https://.../site/`.

Quando houver domínio comercial (registro A dele e do `www` apontando para o
servidor), ele ganha endereço próprio, na raiz e indexável:

```bash
sudo bash nginx/criar-site-vendas.sh laclinicas.com.br
```

---

## Depois: atualizar

No seu computador, `git push`. No servidor:

```bash
cd /var/www/projetos/LA-Clinicas && sudo bash deploy.sh
```

Ordem: mostra os commits novos → **cópia do banco** → `git pull --ff-only` →
`npm ci` → reinicia → espera o sistema pronto (migrations novas rodam aqui) →
**reinicia o site de vendas, se ele estiver instalado** → confere que o código
não é servido pela web, nos dois. Sem nada novo, ele avisa e sai.

---

## Opcional: chat da equipe (LA-Chat)

O conector está instalado e **desligado** (sem `CHAT_SEGREDO_PASSE`). Para
ligar: uma instância do LA-Chat no servidor (como a `lachat@bemestar` da porta
6185), `CHAT_URL` e `CHAT_SEGREDO_PASSE` (≥ 32 caracteres, o mesmo dos dois
lados) no `/etc/laclinicas.env`, e `sudo systemctl restart laclinicas`. O bloco
do WebSocket (`/restrito/chat/ws`) o nginx já tem.
