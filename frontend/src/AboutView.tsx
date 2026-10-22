import developerPhoto from './assets/developer.jpg';

export default function AboutView() {
  return (
    <main className="main-content view-panel about-view" id="view-about">
      <div className="container">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero-copy">
            <h1 id="about-title">Comprendre le Sénat, <em>vote après vote</em></h1>
            <p className="about-lead">
              Regard Sénat rend les scrutins publics plus faciles à consulter. Le projet aide chacune et chacun à comprendre les décisions prises au Parlement et les positions exprimées par les sénateurs.
            </p>
            <div className="about-hero-actions">
              <a className="btn-primary" href="#scrutins">Explorer les scrutins <span aria-hidden="true">↗</span></a>
              <a className="about-text-link" href="#groupes">Découvrir les groupes</a>
            </div>
          </div>

          <aside className="about-conviction-card" aria-label="La conviction au cœur du projet">
            <div className="about-conviction-mark" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                <path d="M24 5 5 15v3h38v-3L24 5Z" fill="currentColor" />
                <path d="M10 21v16m9-16v16m10-16v16m9-16v16M6 41h36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="about-card-eyebrow">Notre conviction</p>
            <blockquote>Une démocratie vivante a besoin de citoyens qui peuvent comprendre les décisions prises en leur nom.</blockquote>
            <span className="about-card-rule" aria-hidden="true" />
            <p className="about-card-caption">Rendre l’information publique lisible est une contribution concrète à la vie civique.</p>
          </aside>
        </section>

        <section className="about-section about-purpose" aria-labelledby="about-purpose-title">
          <div className="about-section-heading">
            <p className="about-section-kicker">Pourquoi ce projet</p>
            <h2 id="about-purpose-title">Mieux comprendre les décisions du Parlement</h2>
          </div>
          <div className="about-purpose-copy">
            <p>
              Les lois et les amendements influencent la vie de toutes et tous. Pourtant, les débats parlementaires et les votes peuvent sembler lointains ou difficiles à suivre. Regard Sénat rassemble les résultats des scrutins, les votes individuels et les positions des groupes dans un même espace de consultation.
            </p>
            <p>
              L’objectif est de donner à chacun des repères simples pour suivre le travail du Sénat, comparer les votes et se forger une opinion à partir des faits. Le site s’adresse aux citoyens, aux étudiants, aux journalistes et à toute personne curieuse de la vie publique.
            </p>
          </div>
        </section>

        <section className="about-section" aria-labelledby="about-explore-title">
          <div className="about-section-heading about-section-heading-wide">
            <div>
              <p className="about-section-kicker">Un même lieu pour explorer</p>
              <h2 id="about-explore-title">Des données, plusieurs façons de les comprendre</h2>
            </div>
            <p className="about-section-intro">Chaque page éclaire une facette du travail parlementaire et permet de remonter aux scrutins qui la composent.</p>
          </div>
          <div className="about-feature-grid">
            <a className="about-feature-card" href="#scrutins">
              <span className="about-feature-index">01</span>
              <h3>Les scrutins</h3>
              <p>Retrouvez les textes adoptés ou rejetés, les résultats et le détail des votes.</p>
              <span className="about-feature-arrow" aria-hidden="true">↗</span>
            </a>
            <a className="about-feature-card" href="#senateurs">
              <span className="about-feature-index">02</span>
              <h3>Les sénateurs</h3>
              <p>Consultez les profils, les groupes, les départements et les historiques de vote.</p>
              <span className="about-feature-arrow" aria-hidden="true">↗</span>
            </a>
            <a className="about-feature-card" href="#groupes">
              <span className="about-feature-index">03</span>
              <h3>Les groupes</h3>
              <p>Découvrez la composition des groupes et la manière dont ils se positionnent.</p>
              <span className="about-feature-arrow" aria-hidden="true">↗</span>
            </a>
            <a className="about-feature-card" href="#stats">
              <span className="about-feature-index">04</span>
              <h3>Les statistiques</h3>
              <p>Observez les tendances et les résultats à l’échelle des sessions parlementaires.</p>
              <span className="about-feature-arrow" aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section className="about-principles" aria-label="Sources et démarche">
          <article className="about-principle-card">
            <span className="about-principle-symbol" aria-hidden="true">01</span>
            <div>
              <h2>Des sources publiques</h2>
              <p>Les informations présentées proviennent des données publiques du Sénat. Les sources officielles restent accessibles afin que chacun puisse vérifier et approfondir les informations.</p>
              <div className="about-source-links">
                <a href="https://www.senat.fr" target="_blank" rel="noopener noreferrer">Consulter senat.fr <span aria-hidden="true">↗</span></a>
                <a href="https://data.senat.fr" target="_blank" rel="noopener noreferrer">Consulter data.senat.fr <span aria-hidden="true">↗</span></a>
              </div>
            </div>
          </article>
          <article className="about-principle-card">
            <span className="about-principle-symbol" aria-hidden="true">02</span>
            <div>
              <h2>Une démarche civique</h2>
              <p>Le projet veut faciliter l’accès à l’information parlementaire et encourager une compréhension plus attentive de la vie démocratique. Il présente les votes pour permettre à chacun de se faire sa propre opinion.</p>
            </div>
          </article>
        </section>

        <section className="about-author" aria-labelledby="about-author-title">
          <img className="about-author-photo" src={developerPhoto} alt="Portrait de Mohamed Khalil Brik" width={400} height={400} loading="lazy" decoding="async" />
          <div className="about-author-copy">
            <p className="about-section-kicker">À l’origine du projet</p>
            <h2 id="about-author-title">Développé par Mohamed Khalil Brik</h2>
            <p>Regard Sénat est une initiative indépendante conçue pour rendre les données parlementaires plus accessibles et utiles à toutes et tous.</p>
          </div>
          <a className="about-author-link" href="https://khalilbriktn.github.io/personal-website/" target="_blank" rel="noopener noreferrer">
            Découvrir son site <span aria-hidden="true">↗</span>
          </a>
        </section>
      </div>
    </main>
  );
}
