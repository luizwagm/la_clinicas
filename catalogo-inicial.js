/* ==========================================================================
   catalogo-inicial.js — o que uma instalação NOVA já traz cadastrado

   Só entra em tabela VAZIA (ver o passo 6 de iniciarRestrito). Depois disso é
   da clínica: ela edita, desativa o que não oferece e cria o que faltar. Nada
   aqui é sobrescrito num boot seguinte.

   PROCEDIMENTOS — o mercado inteiro, por área, para a clínica DESATIVAR o que
   não faz em vez de digitar o que faz. As fontes dos nomes:
     · Práticas integrativas: as 29 da Política Nacional de Práticas
       Integrativas e Complementares (PNPIC — Portarias GM/MS 971/2006,
       849/2017 e 702/2018; musicoterapia, ozonioterapia e homeopatia
       moram na área em que a clínica as procura), mais as usuais de mercado (auriculoterapia,
       ventosaterapia, moxabustão…).
     · Medicina: as especialidades médicas reconhecidas pelo CFM que atendem
       em consultório (as de hospital/laudo — anestesiologia, patologia,
       radiologia, medicina intensiva… — ficaram de fora: não se agenda
       consulta com elas).
     · Demais áreas: os atendimentos que cada profissão oferece em clínica.
   Valor fica EM BRANCO: preço é da clínica, e um número escrito aqui seria
   inventado. Duração é só o ponto de partida — editável no cadastro.

   Procedimentos de MESMO nome (Consulta e Sessão) dividem o prontuário: o
   nome é o tratamento, o tipo é o atendimento. Por isso as terapias de várias
   sessões vêm em par, e as consultas médicas vêm só como Consulta.

   CONVÊNIOS — "Particular" primeiro; depois as principais operadoras de
   atuação nacional, as de autogestão (servidores e estatais) e as
   odontológicas. Registro ANS EM BRANCO de propósito: número de registro
   escrito de memória seria inventado; a clínica preenche o do contrato dela.
   A lista completa da ANS tem centenas de operadoras ativas — não cabe num
   seletor de agenda, e a maioria é de outra cidade.
   ========================================================================== */

const C = ["Consulta"];
const CS = ["Consulta", "Sessão"];
const P = ["Procedimento"];

/* Cada área: cor na agenda, duração padrão (min), anamnese que pede
   ("" = nenhuma) e os itens [nome, tipos, duração própria opcional]. */
const AREAS = [
  { area: "Psicologia", cor: "#24493F", duracao: 50, anamnese: "", itens: [
    ["Psicoterapia Individual — Adulto", CS],
    ["Psicoterapia Individual — Adolescente", CS],
    ["Psicoterapia Infantil", CS],
    ["Psicoterapia de Casal", CS],
    ["Terapia Familiar", CS],
    ["Psicoterapia de Grupo", CS],
    ["Terapia Cognitivo-Comportamental (TCC)", CS],
    ["Terapia do Esquema", CS],
    ["Terapia de Aceitação e Compromisso (ACT)", CS],
    ["Terapia Comportamental Dialética (DBT)", CS],
    ["Gestalt-terapia", CS],
    ["Psicodrama", CS],
    ["EMDR", CS],
    ["Orientação de Pais", CS],
    ["Orientação Profissional e de Carreira", CS],
    ["Avaliação Psicológica", P, 60],
    ["Avaliação Neuropsicológica", P, 60],
    ["Reabilitação Neuropsicológica", CS],
    ["Plantão Psicológico", C],
  ]},
  { area: "Psicanálise", cor: "#7A3E2E", duracao: 50, anamnese: "psicanalise", itens: [
    ["Psicanálise Individual", CS],
    ["Psicanálise de Casal", CS],
    ["Psicanálise Infantil", CS],
  ]},
  { area: "Desenvolvimento e aprendizagem", cor: "#3A5583", duracao: 50, anamnese: "", itens: [
    ["Análise do Comportamento Aplicada (ABA)", CS],
    ["Intervenção Precoce (Modelo Denver)", CS],
    ["Psicopedagogia — Avaliação", P, 60],
    ["Psicopedagogia — Intervenção", CS],
    ["Terapia Ocupacional", CS],
    ["Integração Sensorial", CS],
    ["Musicoterapia", CS],
  ]},
  { area: "Fonoaudiologia", cor: "#5B6B2E", duracao: 45, anamnese: "", itens: [
    ["Fonoaudiologia — Linguagem e Fala", CS],
    ["Fonoaudiologia — Voz", CS],
    ["Fonoaudiologia — Motricidade Orofacial", CS],
    ["Fonoaudiologia — Disfagia", CS],
    ["Fonoaudiologia — Fluência (Gagueira)", CS],
    ["Avaliação do Processamento Auditivo Central", P, 60],
    ["Audiometria", P, 30],
    ["Imitanciometria", P, 20],
  ]},
  { area: "Nutrição", cor: "#2E7D5B", duracao: 60, anamnese: "", itens: [
    ["Nutrição Clínica", CS],
    ["Nutrição Esportiva", CS],
    ["Nutrição Materno-Infantil", CS],
    ["Nutrição Funcional", CS],
    ["Nutrição Comportamental", CS],
    ["Bioimpedância", P, 20],
    ["Avaliação Antropométrica", P, 20],
  ]},
  { area: "Fisioterapia", cor: "#1F6F8B", duracao: 50, anamnese: "", itens: [
    ["Fisioterapia Ortopédica e Traumatológica", CS],
    ["Fisioterapia Neurológica", CS],
    ["Fisioterapia Respiratória", CS],
    ["Fisioterapia Cardiovascular", CS],
    ["Fisioterapia Pélvica", CS],
    ["Fisioterapia Esportiva", CS],
    ["Fisioterapia Pediátrica", CS],
    ["Fisioterapia Geriátrica", CS],
    ["Fisioterapia Dermatofuncional", CS],
    ["Fisioterapia Aquática (Hidroterapia)", CS],
    ["RPG — Reeducação Postural Global", CS],
    ["Pilates Clínico", CS],
    ["Cinesioterapia", CS],
    ["Terapia Manual", CS],
    ["Liberação Miofascial", CS],
    ["Agulhamento a Seco (Dry Needling)", CS],
    ["Bandagem Funcional (Kinesio Taping)", P, 30],
    ["Eletroterapia", P, 30],
    ["Drenagem Linfática Manual", CS],
  ]},
  { area: "Práticas integrativas (PNPIC)", cor: "#8A5A9E", duracao: 60, anamnese: "integrativas", itens: [
    ["Acupuntura", CS],
    ["Apiterapia", CS],
    ["Aromaterapia", CS],
    ["Arteterapia", CS],
    ["Ayurveda", CS],
    ["Biodança", CS],
    ["Bioenergética", CS],
    ["Constelação Familiar", CS],
    ["Cromoterapia", CS],
    ["Dança Circular", CS],
    ["Geoterapia", CS],
    ["Hipnoterapia", CS],
    ["Imposição de Mãos", CS],
    ["Antroposofia Aplicada à Saúde", CS],
    ["Meditação", CS],
    ["Naturopatia", CS],
    ["Osteopatia", CS],
    ["Fitoterapia", CS],
    ["Quiropraxia", CS],
    ["Reflexoterapia", CS],
    ["Reiki", CS],
    ["Shantala", CS],
    ["Terapia Comunitária Integrativa", CS],
    ["Terapia Floral", CS],
    ["Termalismo Social / Crenoterapia", CS],
    ["Yoga", CS],
  ]},
  { area: "Terapias complementares de mercado", cor: "#A0522D", duracao: 50, anamnese: "integrativas", itens: [
    ["Auriculoterapia", CS, 30],
    ["Ventosaterapia", CS],
    ["Moxabustão", CS],
    ["Eletroacupuntura", CS],
    ["Massoterapia", CS],
    ["Detox Iônico", CS, 40],
    ["Exame de Biorressonância", P, 40],
  ]},
  { area: "Ozonioterapia", cor: "#3F7F3F", duracao: 40, anamnese: "ozonio", itens: [
    ["Ozonioterapia", CS],
    ["Protocolo Integrativo — Ozônio e Detox", CS],
  ]},
  { area: "Medicina", cor: "#B4502A", duracao: 30, anamnese: "", itens: [
    ["Clínica Médica", C],
    ["Medicina de Família e Comunidade", C],
    ["Psiquiatria", C, 50],
    ["Psiquiatria da Infância e Adolescência", C, 50],
    ["Neurologia", C],
    ["Neurologia Pediátrica", C],
    ["Geriatria", C],
    ["Pediatria", C],
    ["Cardiologia", C],
    ["Dermatologia", C],
    ["Endocrinologia e Metabologia", C],
    ["Gastroenterologia", C],
    ["Ginecologia e Obstetrícia", C],
    ["Mastologia", C],
    ["Urologia", C],
    ["Nefrologia", C],
    ["Pneumologia", C],
    ["Reumatologia", C],
    ["Alergia e Imunologia", C],
    ["Infectologia", C],
    ["Hematologia e Hemoterapia", C],
    ["Oncologia Clínica", C],
    ["Oftalmologia", C],
    ["Otorrinolaringologia", C],
    ["Ortopedia e Traumatologia", C],
    ["Angiologia", C],
    ["Cirurgia Vascular", C],
    ["Cirurgia Geral", C],
    ["Cirurgia Plástica", C],
    ["Coloproctologia", C],
    ["Nutrologia", C],
    ["Homeopatia", C],
    ["Acupuntura Médica", CS],
    ["Medicina do Esporte", C],
    ["Medicina Física e Reabilitação", C],
    ["Medicina do Trabalho", C],
    ["Medicina de Tráfego", C],
    ["Genética Médica", C],
  ]},
  { area: "Enfermagem", cor: "#55605B", duracao: 30, anamnese: "", itens: [
    ["Consulta de Enfermagem", C],
    ["Curativo", P, 20],
    ["Aplicação de Medicação", P, 15],
    ["Vacinação", P, 15],
    ["Aferição de Pressão e Glicemia", P, 10],
  ]},
  { area: "Estética", cor: "#C2667A", duracao: 60, anamnese: "", itens: [
    ["Limpeza de Pele", P],
    ["Peeling", P],
    ["Microagulhamento", P],
    ["Radiofrequência", P],
    ["Depilação a Laser", P, 30],
    ["Toxina Botulínica", P, 30],
    ["Preenchimento com Ácido Hialurônico", P, 45],
    ["Bioestimulador de Colágeno", P, 45],
    ["Massagem Modeladora", CS],
  ]},
  { area: "Odontologia", cor: "#4A7FA7", duracao: 40, anamnese: "", itens: [
    ["Clínica Geral Odontológica", CS],
    ["Profilaxia (Limpeza)", P],
    ["Restauração", P],
    ["Endodontia (Tratamento de Canal)", CS, 60],
    ["Exodontia (Extração)", P],
    ["Periodontia", CS],
    ["Ortodontia", CS, 30],
    ["Implantodontia", CS, 60],
    ["Prótese Dentária", CS],
    ["Clareamento Dental", P, 60],
    ["Odontopediatria", CS],
    ["Disfunção Temporomandibular (DTM)", CS],
  ]},
];

/* Achatado na ordem da lista: é a ordem (sort) com que aparecem nas telas. */
const PROCEDIMENTOS_INICIAIS = [];
for (const a of AREAS)
  for (const [nome, tipos, dur] of a.itens)
    for (const tipo of tipos)
      PROCEDIMENTOS_INICIAIS.push({ nome, tipo, cor: a.cor, duracao: dur || a.duracao, anamnese: a.anamnese, area: a.area });

const CONVENIOS_INICIAIS = [
  "Particular",
  // operadoras de atuação nacional
  "Allianz Saúde",
  "Amil",
  "Bradesco Saúde",
  "Care Plus",
  "Golden Cross",
  "Hapvida",
  "Mediservice",
  "MedSênior",
  "NotreDame Intermédica",
  "Omint",
  "Porto Seguro Saúde",
  "Prevent Senior",
  "Seguros Unimed",
  "SulAmérica Saúde",
  "Unimed",
  "Alice",
  "Sami",
  "Smile Saúde",
  // autogestão — servidores, estatais e militares
  "Cassi",
  "Geap Saúde",
  "Saúde Caixa",
  "Postal Saúde",
  "Saúde Petrobras",
  "Camed",
  "Capesesp",
  "Cabesp",
  "Economus",
  "Fundação Saúde Itaú",
  "e-Vida",
  "Fachesf",
  "Plan-Assiste",
  "Unafisco Saúde",
  "Sassepe",
  "Fusex",
  "Sistema de Saúde da Marinha",
  "Funsa (Aeronáutica)",
  // odontológicos
  "Amil Dental",
  "Bradesco Dental",
  "MetLife Dental",
  "OdontoPrev",
  "Porto Seguro Odonto",
  "SulAmérica Odonto",
  "Uniodonto",
  // cartões de desconto e convênios locais
  "Cartão de Todos",
  "Efycard",
  "Pad Saúde",
  "Prosmed",
  "São Gabriel",
  "System Saúde",
];

module.exports = { PROCEDIMENTOS_INICIAIS, CONVENIOS_INICIAIS, AREAS_PROCEDIMENTO: AREAS.map((a) => a.area) };
