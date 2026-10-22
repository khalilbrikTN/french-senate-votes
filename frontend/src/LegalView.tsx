import './legal.css';

// Mentions légales (LCEN, art. 6-III) and privacy notice. Addresses of the hosts as published
// by each company; check them again if a host changes.
export default function LegalView() {
  return (
    <main className="main-content view-panel legal-view" id="view-mentions-legales">
      <div className="container legal-container">
        <p className="section-eyebrow">Regard Sénat</p>
        <h1 className="legal-title">Mentions légales et confidentialité</h1>

        <section aria-labelledby="legal-editor">
          <h2 id="legal-editor">Éditeur du site</h2>
          <p>
            Regard Sénat est un projet personnel et indépendant, édité par Mohamed Khalil Brik, qui en est
            aussi le directeur de la publication.
          </p>
          <p>Contact : <a href="mailto:mohamedkhalil.brik@aucegypt.edu">mohamedkhalil.brik@aucegypt.edu</a></p>
          <p>
            Ce site n’est ni affilié au Sénat, ni approuvé ou soutenu par lui. Les informations officielles
            se trouvent sur <a href="https://www.senat.fr" target="_blank" rel="noopener noreferrer">senat.fr</a>.
          </p>
        </section>

        <section aria-labelledby="legal-hosts">
          <h2 id="legal-hosts">Hébergement</h2>
          <ul className="legal-list">
            <li><strong>Site</strong> : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis.</li>
            <li><strong>Serveur de données (API)</strong> : Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis.</li>
            <li><strong>Base de données</strong> : Supabase, Inc., hébergée dans l’Union européenne (Irlande).</li>
          </ul>
        </section>

        <section aria-labelledby="legal-data">
          <h2 id="legal-data">Données et sources</h2>
          <p>
            Les scrutins, les votes et les informations sur les sénateurs proviennent des données ouvertes
            du Sénat (<a href="https://data.senat.fr" target="_blank" rel="noopener noreferrer">data.senat.fr</a>),
            réutilisées sous la Licence Ouverte Etalab 2.0. Les photographies des sénateurs sont affichées depuis
            senat.fr et restent la propriété du Sénat.
          </p>
          <p>
            Les thèmes, les taux de loyauté et les autres indicateurs sont calculés par le site à partir de ces
            données. Ils peuvent comporter des erreurs ou des approximations : en cas de doute, la source
            officielle fait foi. Pour signaler une erreur, écrivez à l’adresse ci-dessus.
          </p>
        </section>

        <section aria-labelledby="legal-privacy">
          <h2 id="legal-privacy">Confidentialité</h2>
          <ul className="legal-list">
            <li>Aucun compte, aucune publicité, aucun cookie.</li>
            <li>
              <strong>Mesure d’audience</strong> : le site compte ses visites avec Cloudflare Web Analytics,
              un outil sans cookie qui ne conserve pas les adresses IP à cette fin et ne produit que des
              statistiques globales (nombre de visites, pages vues, pays, type d’appareil).
            </li>
            <li>
              <strong>Journaux techniques</strong> : comme pour tout site, les hébergeurs (Cloudflare, Render)
              traitent l’adresse IP des visiteurs pour acheminer les pages et assurer la sécurité. Ces données
              ne sont ni exploitées ni conservées par l’éditeur.
            </li>
            <li>
              <strong>Photographies</strong> : elles sont chargées depuis senat.fr ; votre navigateur contacte
              alors ce site, qui applique sa propre politique de confidentialité.
            </li>
          </ul>
          <p>
            Pour toute question sur vos données, écrivez à l’adresse ci-dessus. Vous pouvez aussi adresser
            une réclamation à la <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">CNIL</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
