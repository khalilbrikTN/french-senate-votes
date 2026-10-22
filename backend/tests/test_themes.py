"""Checks of the title classifier (app/themes.py). Run from backend/: python -m unittest discover tests"""

import unittest

from app import themes


class ThemeTests(unittest.TestCase):
    CASES = [
        # Budget texts win over the subject of the amendment (defence credits here).
        ("sur les crédits de la mission défense du projet de loi de finances pour 2008, adopté par "
         "l'Assemblée nationale", "budget"),
        ("sur l'ensemble du projet de loi de finances de fin de gestion pour 2024", "budget"),
        ("sur l'amendement n° 97, présenté par M. Richard Yung et plusieurs de ses collègues, à l'article 15 "
         "du projet de loi, adopté par l'Assemblée nationale, de financement de la sécurité sociale pour 2016",
         "social"),
        ("sur l'article 19 du projet de loi, adopté par l'Assemblée nationale après engagement de la procédure "
         "accélérée, portant réforme des retraites", "social"),
        # Health texts are Santé; health insurance (« complémentaire santé ») and autonomy stay social.
        ("sur l'ensemble du projet de loi relatif à l'organisation et à la transformation du système de santé",
         "sante"),
        ("sur l'ensemble de la proposition de loi visant à améliorer l'accès aux soins par la territorialisation",
         "sante"),
        ("sur l'ensemble de la proposition de loi relative à la complémentaire santé des salariés", "social"),
        ("sur l'ensemble du projet de loi relatif à l'adaptation de la société au vieillissement", "social"),
        # Group names before the text (« groupe écologiste ») are ignored.
        ("sur le sous-amendement n° 4745, présenté par Mme Mélanie Vogel et les membres du groupe Écologiste - "
         "Solidarité et Territoires, à l'amendement n° 1968 rectifié quater, à l'article 7 du projet de loi "
         "de financement rectificative de la sécurité sociale pour 2023", "social"),
        # « article 49, alinéa 3, de la Constitution » must not make it an Institutions vote.
        ("sur l'amendement n° 347, présenté par Mme Nicole Bricq, à l'article 2 du projet de loi, considéré "
         "comme adopté par l'Assemblée nationale en application de l'article 49, alinéa 3, de la Constitution, "
         "visant à instituer de nouvelles libertés et de nouvelles protections pour les entreprises et les "
         "actif-ve-s", "travail"),
        ("sur l’ensemble de la proposition de loi visant à donner aux acteurs locaux les moyens de lutter "
         "contre la cabanisation", "logement"),
        ("sur l'article 1er du projet de loi relatif à la transition énergétique pour la croissance verte",
         "environnement"),
        ("sur l'ensemble du texte élaboré par la commission mixte paritaire sur la proposition de loi "
         "modifiant la définition pénale du viol et des agressions sexuelles", "justice"),
        ("sur l'ensemble du projet de loi pour une immigration maîtrisée, un droit d'asile effectif et une "
         "intégration réussie", "immigration"),
        ("sur l'autorisation de la prolongation de l'intervention des forces armées au Liban", "international"),
        ("sur l'ensemble de la proposition de loi organique portant réforme du financement de l'audiovisuel "
         "public", "culture"),
        ("sur l'ensemble du projet de loi constitutionnelle de modernisation des institutions de la Ve "
         "République", "institutions"),
        ("sur la déclaration de politique générale du Gouvernement", "institutions"),
        ("sur l'ensemble du projet de loi portant réforme ferroviaire", "transports"),
        ("sur l'ensemble du projet de loi pour une école de la confiance", "education"),
        ("sur l'ensemble de la proposition de loi pour un choc de compétitivité en faveur de la ferme France",
         "agriculture"),
        ("sur l'ensemble du projet de loi ouvrant le mariage aux couples de personnes de même sexe", "societe"),
        ("sur l'ensemble du projet de loi relatif au Grand Paris", "collectivites"),
        ("sur l'ensemble du projet de loi relatif à la croissance et la transformation des entreprises",
         "economie"),
        ("", "autres"),
    ]

    def test_known_titles(self):
        for title, expected in self.CASES:
            with self.subTest(title=title[:60]):
                self.assertEqual(themes.classify_theme(title), expected)

    def test_every_theme_has_a_label(self):
        rule_themes = {theme for theme, _ in themes.THEME_RULES}
        self.assertLessEqual(rule_themes, set(themes.THEME_IDS))
        self.assertEqual(themes.THEME_IDS[-1], "autres")

    def test_normalize(self):
        self.assertEqual(themes.normalize("Sur l’Œuvre  ÉLÉMENTAIRE n°"), "sur l'oeuvre elementaire n")


class VoteTypeTests(unittest.TestCase):
    CASES = [
        ("sur l'ensemble du projet de loi de finances pour 2025", "ensemble"),
        ("sur l’article 12 constituant l'ensemble de la proposition de loi constitutionnelle", "ensemble"),
        ("sur l'ensemble du texte élaboré par la commission mixte paritaire sur la proposition de loi", "ensemble"),
        ("sur l'ensemble de la première partie du projet de loi de finances pour 2015", "article"),
        ("sur l'article 1er du projet de loi relatif à la transition énergétique", "article"),
        ("sur les crédits de la mission défense du projet de loi de finances pour 2008", "article"),
        ("sur l'amendement n° 5, présenté par M. X, à l'article 1er de la proposition de loi", "amendement"),
        ("sur les amendements identiques n° 46 rectifié ter et n° 446", "amendement"),
        ("sur le sous-amendement n° 4745", "amendement"),
        ("sur les six amendements tendant à supprimer l'article 1A", "amendement"),
        ("sur la motion n° 1, présentée par M. Y, tendant à opposer la question préalable", "motion"),
        ("sur la déclaration de politique générale du Gouvernement", "autre"),
    ]

    def test_known_titles(self):
        for title, expected in self.CASES:
            with self.subTest(title=title[:60]):
                self.assertEqual(themes.classify_vote_type(title), expected)


if __name__ == "__main__":
    unittest.main()
