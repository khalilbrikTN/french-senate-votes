// Political groups metadata (seats: static fallback, live counts come from /api/stats)
// Group presidents: data.senat.fr ODSEN_HISTOGROUPES (file dated 20 Oct 2026)
// Colours: the group colours of the hemicycle on the senat.fr home page (<hemicycle-groups>, Oct 2026),
// lightened (same hue) where needed to reach a 4.5:1 contrast on the dark cards (#141929):
// LR #2E70D1, CRCE-K #D90001, RDSE #814A97, UNT #173680, NI #000000. UNT is also shifted
// slightly towards indigo and LR lightened a little more so that the two blues stay distinct.
export interface PoliticalGroup {
  name: string;
  short: string;
  color: string;
  seats: number;
  leader: string;
  orientation: string;
  desc: string;
}

export const POLITICAL_GROUPS: Record<string, PoliticalGroup> = {
  'LR': {
    name: 'Les Républicains',
    short: 'LR',
    color: '#6092dc',
    seats: 124,
    leader: 'Mathieu Darnaud',
    orientation: 'Droite républicaine',
    desc: 'Premier groupe du Sénat, formant la majorité sénatoriale avec l\'Union centriste et indépendants. Gérard Larcher (LR) a été réélu président du Sénat le 1er octobre 2026.',
  },
  'SER': {
    name: 'Socialiste, Écologiste et Républicain',
    short: 'SER',
    color: '#fb6f99',
    seats: 62,
    leader: 'Patrick Kanner',
    orientation: 'Gauche républicaine & social-démocratie',
    desc: 'Troisième groupe du Sénat par ses effectifs depuis octobre 2026 et principal groupe de gauche.',
  },
  'UC': {
    name: 'Union Centriste et Indépendants',
    short: 'UC',
    color: '#7accea',
    seats: 63,
    leader: 'Hervé Marseille',
    orientation: 'Centre droit & centrisme pro-européen',
    desc: 'Deuxième groupe du Sénat depuis octobre 2026, formant la majorité sénatoriale avec Les Républicains.',
  },
  'RDPI': {
    name: 'Rassemblement des démocrates, progressistes et indépendants',
    short: 'RDPI',
    color: '#f1b608',
    seats: 16,
    leader: 'Xavier Iacovelli',
    orientation: 'Centre & sensibilité macroniste',
    desc: 'Groupe réunissant des sénateurs se réclamant d\'Emmanuel Macron, présidé depuis le 30 septembre 2026 par Xavier Iacovelli.',
  },
  'CRCE-K': {
    name: 'Communiste Républicain Citoyen et Écologiste – Kanaky',
    short: 'CRCE-K',
    color: '#ff1a1b',
    seats: 18,
    leader: 'Cécile Cukierman',
    orientation: 'Gauche communiste & antilibérale',
    desc: 'Groupe défendant les services publics, le pouvoir d\'achat et les droits des territoires ultramarins.',
  },
  'GEST': {
    name: 'Écologiste – Solidarité et Territoires',
    short: 'GEST',
    color: '#5cb88d',
    seats: 15,
    leader: 'Mélanie Vogel',
    orientation: 'Écologie politique & transition énergétique',
    desc: 'Promeut la bifurcation écologique, la justice sociale et la préservation de la biodiversité.',
  },
  'RDSE': {
    name: 'Rassemblement Démocratique et Social Européen',
    short: 'RDSE',
    color: '#a36eb8',
    seats: 18,
    leader: 'Maryse Carrère',
    orientation: 'Radicalisme & centre-gauche laïque',
    desc: 'Le plus ancien groupe parlementaire de l\'histoire républicaine, d\'inspiration radicale.',
  },
  'LIRT': {
    name: 'Les Indépendants – République et Territoires',
    short: 'LIRT',
    color: '#c7dde2',
    seats: 15,
    leader: 'Claude Malhuret',
    orientation: 'Libéral-conservateur & centre-droit',
    desc: 'Groupe d\'inspiration libérale et décentralisatrice.',
  },
  'UNT': {
    name: 'Union Nationale pour les Territoires',
    short: 'UNT',
    color: '#7575eb',
    seats: 15,
    leader: 'Edwige Diaz',
    orientation: 'Nouveau groupe (octobre 2026)',
    desc: '',
  },
  'NI': {
    name: 'Non-Inscrits',
    short: 'NI',
    color: '#828282',
    seats: 2,
    leader: 'Aucun (Indépendants)',
    orientation: 'Sans groupe',
    desc: 'Sénateurs ne figurant sur la liste d\'aucun groupe (Gabriel Amard et Paul Mougenot en octobre 2026).',
  },
};

export const GROUP_CODES = Object.keys(POLITICAL_GROUPS);

// Former Senate group codes (career timelines). Predecessor groups reuse their successor's colour;
// the others follow French Wikipedia's party colours ({{Infobox Parti politique français/couleurs}}).
// Codes without a reliable convention (CRARS, GDSRG, RP) keep the hashed fallback.
export const HISTORICAL_GROUP_COLORS: Record<string, string> = {
  RPR: '#6092dc', UNR: '#6092dc', UDR: '#6092dc',            // gaullists, LR lineage (Wikipedia #0066cc)
  RI: '#26c4ec', UREI: '#26c4ec', CNIP: '#26c4ec', RIAS: '#26c4ec', // Républicains indépendants / CNIP
  UCDP: '#7accea', RPCD: '#7accea',                           // predecessors of the Union centriste group
  MRP: '#00ffff',                                             // Christian democrats (Wikipedia)
  GD: '#a36eb8', RDE: '#a36eb8',                              // former names of the RDSE group
  C: '#ff1a1b',                                               // communists, CRCE-K lineage
  ECO: '#5cb88d',                                             // Groupe écologiste 2012-2017, GEST lineage
};

// The Senate files use internal group codes; map them to the short codes of POLITICAL_GROUPS for colours.
export const SENATE_GROUP_CODE_ALIASES: Record<string, string> = {
  UMP: 'LR', SOC: 'SER', CRC: 'CRCE-K', LREM: 'RDPI', RTLI: 'LIRT', AUCUN: 'NI',
};
