"""Automatic theme and vote-type classification of public votes, from their titles.

Single source of truth for the theme rules used by /api/scrutins (`theme`, `voteType`)
and /api/stats/themes. The classification is APPROXIMATE: it reads only the vote title
(« sur l'amendement n° 5 … à l'article 1er de la proposition de loi relative à … »),
not the content of the amendment or of the text, and gives each vote ONE primary theme.

How it works:
1. The title is normalised (lower case, no accents, straight apostrophes, single spaces).
2. The subject is the part of the title from the first « projet / proposition de loi /
   de résolution » onwards (the text being voted on). Everything before it, such as the
   amendment authors and their group names (« groupe écologiste »), is ignored. Procedural
   phrases that would mislead the keywords (« en application de l'article 49, alinéa 3, de
   la Constitution », « adopté par l'Assemblée nationale ») are removed. Titles without a
   text (declarations of the Government, armed forces authorisations, Conférence des
   Présidents) are matched on their whole title.
3. THEME_RULES are tried in order and the first match wins, so the more specific rules come
   first: a vote on the « projet de loi de finances » is Budget even when the amendment is
   about defence credits, a « loi organique relative aux lois de financement de la sécurité
   sociale » is Sécurité sociale, and the generic Institutions markers (loi organique,
   constitutionnelle) only apply when nothing more specific matched.
4. A vote matched by no rule is « autres ».

Changing a rule changes the theme of past votes on the next cache rebuild (no database
change); the frontend only reads `theme` ids and labels from the API.
"""

import re
import unicodedata

# (id, French label). Order = display order; "autres" last.
THEMES = (
    ("budget", "Budget & fiscalité"),
    ("social", "Sécurité sociale & santé"),
    ("travail", "Travail & emploi"),
    ("economie", "Économie & entreprises"),
    ("transports", "Transports & numérique"),
    ("environnement", "Environnement & énergie"),
    ("agriculture", "Agriculture & alimentation"),
    ("logement", "Logement & urbanisme"),
    ("collectivites", "Collectivités & outre-mer"),
    ("justice", "Justice & sécurité"),
    ("immigration", "Immigration & asile"),
    ("societe", "Société & droits"),
    ("education", "Éducation & recherche"),
    ("culture", "Culture, médias & sport"),
    ("international", "International & défense"),
    ("institutions", "Institutions & élections"),
    ("autres", "Autres"),
)
THEME_LABELS = dict(THEMES)
THEME_IDS = tuple(theme_id for theme_id, _ in THEMES)

# Ordered (theme, pattern) rules on the normalised subject; the first match wins.
# Patterns are regular expressions on accent-free lower-case text (\b = word boundary).
THEME_RULES = (
    # Texts whose kind decides the theme, whatever the article or amendment.
    ("budget", r"\blois? de finances\b|\bde finances (rectificative|pour|de fin)|finances rectificative"
               r"|programmation des finances publiques|reglement du budget|approbation des comptes"
               r"|reglement des comptes|\bloi de reglement\b|\bloi rectificative\b"),
    ("social", r"financement (rectificative )?de (la )?securite sociale|lois? de financement de la securite"
               r"|dette sociale"),
    # Specific subjects whose wording would otherwise trip a broader rule below.
    ("institutions", r"moyens de controle des senateurs|travail du senat|reglement du senat|autorites administratives independantes"),
    ("culture", r"creation sur internet|propriete litteraire"),
    ("societe", r"voile integral"),
    # Armed forces, treaties and international agreements.
    ("international", r"forces armees|forces aeriennes|programmation militaire|\bdefense\b(?! des droits)"
                      r"|\bmilitaires?\b|autorisant la (ratification|approbation)|\bratification de l'accord"
                      r"|\btraite (de lisbonne|sur|instituant|etablissant|portant|international)|\baccord (europeen|entre|de partenariat)|resolution europeenne"
                      r"|union europeenne|\bconvention (entre|internationale)|\bukraine\b|\bgrece\b"
                      r"|programme de stabilite|conseil europeen|\bhaiti\b|haut-karabagh|armenie|palestine|israel|genocide (ukrainien|armenien)"
                      r"|inegalites mondiales|aide publique au developpement|amerique latine|developpement solidaire|\binternational|anciens combattants|carte du combattant|essais nucleaires"),
    ("agriculture", r"agrivoltaisme|pastoralisme|phytopharmaceutiques|pesticides|neonicotinoides|betteraves|genetiquement modifies"),
    ("immigration", r"immigration|\basile\b|\betrangers?\b|\bnationalite\b|\bsejour\b|irreguliere?"
                    r"|integration reussie|\bmigra|protection temporaire|ressortissants"),
    ("social", r"\bsante\b|sanitaire|\bhopita|hospitali|\bsoins\b|medic|\bpatients?\b|bioethique"
               r"|fin de vie|aide a mourir|palliatif|\bretraites?\b|vieillissement|\bautonomie\b"
               r"|handicap|\bmaladies?\b|\bmalades\b|infirmi|pharmac|psychiatri|interruption volontaire"
               r"|\bivg\b|complementaire sante|mutuelles|allocations? familiales|prestations sociales"
               r"|protection sociale|aidants|\bfraudes? sociales?|biologie medicale|produits de sante"
               r"|grossesse|\bdependance\b|ehpad|\bdeserts? medicaux|\bvaccin|covid|pandemie|epidemi"
               r"|tabac|alcool|addiction|drogue|cannabis|\bsoignants?\b|\bmedecins?\b|chlordecone"
               r"|avortement|mourir dans la dignite|cancers?\b|vieillir|arret cardiaque|gestes qui sauvent|chirurgi|perturbateurs endocriniens"
               r"|assistant familial|revenu de solidarite|politiques d\'insertion|revenu de base|\bminima sociaux|\brsa\b"),
    ("budget", r"finances publiques|\bfiscal|\bimpots?\b|\bimposition\b|\btaxes?\b|\btaxation\b"
               r"|\bdette\b|\bbudget|bouclier fiscal|\btva\b|contribution exceptionnelle|\bisf\b"),
    ("travail", r"\btravail\b|\bemploi\b|\bchomage\b|\bchomeurs\b|\bsalaries?\b|\bsalaires?\b|licenciement"
                r"|dialogue social|democratie sociale|formation professionnelle|\bapprentissage\b|alternance"
                r"|repos dominical|\b1er mai\b|temps de travail|avenir professionnel|\bactifs\b|actif-ve-s|nouvelles protections pour les entreprises"
                r"|\bstages?\b|stagiaires|travailleurs|fonction publique|participation et (de )?l'interessement"
                r"|contrat de generation|plein emploi|professionnalisation|activite professionnelle|\bsyndica|prud'hom|inspection du travail|independance fictive"
                r"|travail social"),
    ("agriculture", r"agricol|agriculteur|agriculture|alimentation|alimentaire|\bpeche\b|\bforet|\belevage"
                    r"|ferme france|phytosanitaire|pesticide|produits phyto|\bvitic|\bviticulture|\bvin\b"
                    r"|\brural|ruraux|\bsols? vivants|\bsemences|\bbetail|\bglyphosate"),
    ("environnement", r"environnement|\benerg|climat|biodiversite|grenelle|ecolog|\belectricite|\bgaz\b"
                      r"|nucleaire|hydrocarbures|\bdechets|economie circulaire|gaspillage|\beau\b|\beaux\b"
                      r"|pollution|artificialisation|ecocide|\bchasse\b|\bmines?\b|renouvelables|industrie verte"
                      r"|perfluoro|ecosystemes|ondes electromagnetiques|\bloups?\b|electrique|\bhaies?\b|incendie|assainissement|milieux aquatiques|inondations|gemapi|catastrophes naturelles|emballages|risques technologiques|\bmarins?\b|littoral|\banimal|\banimaux|corrida|maltraitance animale"
                      r"|\bparcs? nationa|\bnature\b|\bpaysages|textile|carbone|\bplastique|bruit"),
    ("logement", r"logements?\b|locati|\bhabitat|urbanisme|\bbati\b|\bloyers?\b|coproprie|cohesion urbaine|politique de la ville|centres-villes|centres-bourgs|\bbailleurs?"
                 r"|foncier|retrait-gonflement|cabanisation|hlm|\bimmobilier|construction"),
    ("transports", r"ferroviaire|\bsncf\b|\bratp\b|\btransports?\b|mobilites|\bports\b|\bport (maritime|autonome)|aerien|aeroport"
                   r"|autoroutes?|autoroutiere|portuaire|\broutier|\bbus\b|pass navigo|\btaxis?\b|vtc|\bvoitures?\b|\bvehicules?"
                   r"|numerique|internet|telecommunication|\bpostal|\bla poste\b|\bdonnees personnelles"
                   r"|services numeriques|informations du secteur public|\bplateformes?\b|intelligence artificielle|cyber|reseaux sociaux"),
    ("justice", r"justice|judiciaire|juridiction|\bpenal|\bpeines?\b|recidive|prison|penitentiaire|detenus"
                r"|\bpolices?\b|securite interieure|securite globale|terroris|renseignement|etat d'urgence"
                r"|violences?|delinquan|narcotrafic|\bcrimes?\b|crimin|magistrat|procureur|\bviol\b"
                r"|agressions sexuelles|ordre public|manifestations|hooliganisme|securite routiere|\barmes\b"
                r"|prostitution|entrisme|dissimulation du visage|\bmineurs\b|gendarmerie|\bavocats?\b"
                r"|contentieux|\bproces\b|\bdroit penal|corruption|lanceurs d'alerte|fraude|\bvictimes\b"
                r"|protection de la nation|securite (interieure|publique|civile|globale|routiere|des personnes)|\bsurete|videoprotection|cour d'assises"
                r"|consultations juridiques|execution des decisions|inculpation|garde a vue"
                r"|cours d'appel|ministere de l'interieur|douane|attentat|retention administrative|plaques d'immatriculation|biometrique|controles d'identite|ingerences|protoxyde|contrefacon|permis a points|limitation de vitesse|proxenetisme|services sexuels|privation de liberte|majeurs proteges|protection juridique"
                r"|entraves|sapeurs-pompiers|protection de l\'identite|gens du voyage|tranquillite|stupefiants"),
    ("collectivites", r"collectivites|territoriale?s?\b|\bcommunes?\b|communal|intercommunal|metropol"
                      r"|departements?\b|departementa|\bregions?\b|regiona|\belus? locaux|\belu local"
                      r"|conseillers? territoria|decentralisation|grand paris|statut de paris|vie locale"
                      r"|libertes locales|responsabilites locales|outre-mer|ultramarin|mayotte|nouvelle-caledonie|\bcorse\b"
                      r"|polynesie|guyane|reunion|martinique|guadeloupe|\bmaires?\b|\bmontagne\b"
                      r"|\bmairies?\b|amenagement du territoire|\bterritoires\b|cohesion des territoires"),
    ("education", r"\becoles?\b|\beleves?\b|enseignement|education|universit|etudiant|\brecherche\b"
                  r"|scolaire|academique|enseignants|baccalaureat|\blycee|\bcollege\b|maternelle"
                  r"|\bcreches?|petite enfance|hors contrat|\bjeunesse\b|service civique|orientation et (a )?la reussite"),
    ("culture", r"\bculture|audiovisuel|television|\bradio|\bmedias?\b|\bpresse\b|journalistes|patrimoine"
                r"|liberte de la creation|architecture|\blivres?\b|cinema|\bsport|olympique|football|artistes|langue francaise|\bmusees?\b|langues regionales"
                r"|droit d'auteur|internet et la creation|\barts?\b|spectacle|bibliotheque|france televisions|notre-dame|cathedrale|manipulation de l\'information|demarchage telephonique"
                r"|pluralisme"),
    ("economie", r"entreprises?\b|\beconomi|croissance|commerc|consommat|concurrence|industri|\bbancaires?"
                 r"|\bbanques?\b|privatisation|nationalisation|pouvoir d'achat|competitivite|artisan"
                 r"|\bsocietes\b|\bactionna|financier|financiere|\bepargne|\bassurance|\bprix\b|\btarifs?"
                 r"|\bmarches? publics|\bcommande publique|\bpme\b|\bstart-up|tourisme|simplification|entrepreneur|actions de groupe|prets structures"
                 r"|\binvestissement|\bfaillite|\bsouverainete economique|\bsecret des affaires|\bdirective"),
    ("societe", r"mariage|couples|egalite entre les femmes|femmes et (les )?hommes|\bparite\b|discriminat"
                r"|laicite|\bcultes?\b|religi|homosexualite|orientation sexuelle|identite de genre"
                r"|\benfants?\b|\bfamilles?\b|parental|filiation|adoption\b|egalite et (a )?la citoyennete"
                r"|principes de la republique|separatisme|commemoration|genocides?\b|journee (nationale|des morts)|resistance|repression|\bmemoire\b|souvenir"
                r"|harkis|esclavage|\bdroits des femmes|\bfemmes\b|\bcitoyennete|\bassociations?\b|\bbenevol"
                r"|pauvrete|lutte contre l\'exclusion|\bsolidarite\b|conjugal|funerailles|fusilles|dix-huit ans|majorite numerique"),
    # Generic institutional markers, last: only when nothing more specific matched.
    ("institutions", r"constitution|\borganique\b|elections?\b|electora|\belectiv|scrutin|parlement"
                     r"|\bsenat|\bdeputes?\b|legislation en commission|\bcumul\b|transparence de la vie|etablis hors de france|autorites (administratives|publiques) independantes|cabinets de conseil|vie publique|vie politique"
                     r"|action publique|referendum|defenseur des droits|conseil economique|president de la republique"
                     r"|gouvernement|politique generale|conference des presidents|ordre du jour|seances?\b"
                     r"|\bmandats?\b|\bordonnances\b|\bpetition|\bdemocratie|\bpartis politiques|\bcampagne"
                     r"|\bministres?\b|\badministration|\betat\b|lobbying|\bdeontologie|conflits d'interets"),
)
_COMPILED_RULES = tuple((theme, re.compile(pattern)) for theme, pattern in THEME_RULES)

# Vote types, from the start of the title.
VOTE_TYPES = (
    ("ensemble", "Ensemble du texte"),
    ("article", "Article ou partie"),
    ("amendement", "Amendement"),
    ("motion", "Motion"),
    ("autre", "Autre"),
)
VOTE_TYPE_LABELS = dict(VOTE_TYPES)

_SUBJECT = re.compile(r"\b(projets?|propositions?) de (loi|resolution)\b")
# Procedural phrases that carry misleading keywords (Constitution, Assemblée nationale...).
_BOILERPLATE = re.compile(
    r"(en application|au titre|sur le fondement) d[eu] (l'|la |troisieme |quatrieme )?(article|alinea)[^,;]*?"
    r"de la constitution"
    r"|considere(e)? comme adopte(e)?[^,;]*"
    r"|\b(adopte|adoptee|adoptes|modifie|modifiee|adapte)\b[^,;]*?(par l'assemblee nationale|par l'assemble nationale)"
    r"|apres (engagement de la procedure acceleree|declaration d'urgence)"
    r"|engagement de la procedure acceleree|\(?procedure acceleree\)?|\(?urgence declaree\)?"
    r"|alinea \d+,? de la constitution"
    r"|dont le senat (est|a ete) saisi[^,;]*"
    r"|dans la redaction (du texte )?(proposee|resultant|issue)[^,;]*"
    r"|(texte )?elabore par la commission mixte paritaire|commission mixte paritaire"
    r"|\(?(en )?(nouvelle|premiere|deuxieme|troisieme) lecture\)?"
)
_SPACES = re.compile(r"\s+")


def normalize(title):
    """Lower case, accents and ligatures removed, straight apostrophes, single spaces."""
    text = (title or "").replace("’", "'").replace("‘", "'").replace("`", "'")
    text = text.replace(" ", " ").replace("œ", "oe").replace("Œ", "oe").replace("æ", "ae")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    return _SPACES.sub(" ", text).strip()


def subject(title):
    """The normalised part of the title naming the text voted on (see the module docstring)."""
    text = normalize(title)
    match = _SUBJECT.search(text)
    if match:
        text = text[match.start():]
    return _SPACES.sub(" ", _BOILERPLATE.sub(" ", text)).strip(" ,.;")


def classify_theme(title):
    """Primary theme id of a vote title ("autres" when no rule matches)."""
    text = subject(title)
    for theme, pattern in _COMPILED_RULES:
        if pattern.search(text):
            return theme
    return "autres"


_PART = r"(premiere|seconde|deuxieme|troisieme|quatrieme) partie"
_TYPE_RULES = (
    # A part of a budget text (« l'ensemble de la première partie ») is a part, not the whole.
    ("article", re.compile(r"^(sur )?(l'ensemble de )?la " + _PART)),
    # « l'ensemble », « l'article unique constituant l'ensemble », « le texte élaboré par la CMP »,
    # « sur le projet de loi … » (the whole text).
    ("ensemble", re.compile(r"^(sur )?(l' ?ensemble\b|l'article (unique|\S+) constituant l'ensemble"
                            r"|les conclusions (du rapport )?de la commission mixte paritaire"
                            r"|le texte elabore par la commission mixte paritaire"
                            r"|le projet de loi|la proposition de (loi|resolution))")),
    # « l'amendement », « les amendements identiques », « les six amendements », « le II de l'amendement »
    ("amendement", re.compile(r"^(sur )?((l' ?|les |le |un )?(\w+ )?(sous[- ])?amendements?\b"
                              r"|le [ivx]+( bis)? de l'amendement)")),
    ("motion", re.compile(r"^(sur )?(la |les )?motions?\b|^(sur )?(la )?(question prealable|exception d'irrecevabilite"
                          r"|demande de renvoi en commission)")),
    ("article", re.compile(r"^(sur |a )?(l' ?|les )?articles?\b|^(sur )?les credits\b|^(sur )?l'etat\b"
                           r"|^(sur )?le paragraphe\b")),
)


def classify_vote_type(title):
    """What was voted on: ensemble | article | amendement | motion | autre (from the title start)."""
    text = re.sub(r"^qur ", "sur ", normalize(title))  # one title has a typo
    for vote_type, pattern in _TYPE_RULES:
        if pattern.search(text):
            return vote_type
    return "autre"
