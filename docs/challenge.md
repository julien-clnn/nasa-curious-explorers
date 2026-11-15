# Le défi : harmonisation des hotspots MODIS et VIIRS

> Sources : [transcription de la vidéo du défi (CONAE)](challenge-video-transcript-conae.txt) et [page NASA FIRMS](https://www.earthdata.nasa.gov/data/tools/firms).
> Les éléments marqués **à vérifier** ou **à confirmer** n'ont pas encore été validés.

## Contexte

La **CONAE** (agence spatiale argentine) assure l'alerte précoce et la réponse d'urgence sur des événements dans le monde entier : incendies, inondations, marées noires. Près de la moitié de ces urgences sont des **feux**, qu'il s'agisse de feux de forêt ou de feux d'origine humaine (agriculture, industrie, défrichement).

Pour suivre ces feux, les scientifiques utilisent les **hotspots** : des points chauds détectés par satellite, qui indiquent les zones où un feu actif est le plus probable. Avec les données historiques, ces hotspots alimentent aussi un **calendrier d'activité des feux** (*burning / fire activity calendar*). Cet outil montre les tendances, les anomalies et la saisonnalité, par exemple le nombre de hotspots d'un mois donné sur plusieurs années.

Les modèles climatiques prévoient des conditions propices aux feux plus fréquentes et plus intenses, ce qui rend ces outils de plus en plus importants.

## Le problème

Les hotspots sont enregistrés depuis plus de 20 ans, mais par **deux familles de capteurs dont les données ne sont pas directement comparables** :

| | MODIS | VIIRS |
|---|---|---|
| Satellites | Terra, Aqua | Suomi NPP, NOAA-20, NOAA-21 |
| Résolution | 1 km (centre du pixel) | 375 m (centre du pixel) |
| Sensibilité | Moins sensible aux petits feux | Plus sensible aux petits feux, bien meilleur de nuit |
| Heures de passage | Différentes de VIIRS | Différentes de MODIS |
| Statut | **En fin de vie opérationnelle** | Remplaçant de MODIS |

Comme MODIS est en train d'être retiré au profit de VIIRS, il faut une méthode pour comparer les deux. Sans elle, **près de 10 ans d'historique deviendraient inutilisables**, et les gestionnaires de feux perdraient le calendrier qui leur dit quand et où les feux se produisent.

S'y ajoute un point d'actualité : **Suomi NPP ne livre plus de nouvelles données depuis le 2 novembre 2026**. La continuité VIIRS repose désormais sur NOAA-20 et NOAA-21.

## Ce qui est attendu

Développer un **calendrier d'activité des feux harmonisé**, qui combine la profondeur historique de MODIS avec la continuité et la précision de VIIRS, pour obtenir une **série temporelle cohérente** de l'activité des hotspots.

La CONAE propose de découper le travail en deux parties :

1. **Harmonisation des données.** À la fin de cette phase, l'origine d'un hotspot (MODIS ou VIIRS) ne doit plus avoir d'importance. L'analyse porte sur les tendances, les anomalies et les motifs.
2. **Application web.** Elle prend les hotspots harmonisés en entrée et les affiche sous forme de calendrier. L'utilisateur peut choisir un jour et une région précis, voir l'historique de l'activité des feux, et éventuellement consulter des analyses.

Les équipes peuvent aussi aborder le défi autrement, du moment que l'approche fonctionne.

## Tableau des contraintes

| # | Catégorie | Contrainte | Source | Statut | Impact sur le projet |
|---|---|---|---|---|---|
| C1 | Données | Les hotspots MODIS et VIIRS ne sont pas directement comparables (résolution, sensibilité, heures de passage) | Défi | Ferme | C'est le cœur scientifique : on ne peut pas additionner ni comparer les comptes bruts |
| C2 | Données | MODIS est en fin de vie et VIIRS le remplace | Défi | Ferme | La méthode doit permettre de prolonger la série avec VIIRS seul |
| C3 | Données | Suomi NPP s'est arrêté le 2 novembre 2026 ; VIIRS continue avec NOAA-20 et NOAA-21 | FIRMS | Ferme | Il faudra peut-être aussi harmoniser entre satellites VIIRS |
| C4 | Données | Source recommandée : NASA FIRMS (plus les ressources de la CONAE et d'autres agences) | Défi | Ferme | FIRMS est notre source principale |
| C5 | Données | Utiliser les archives de qualité scientifique (*standard*) plutôt que le quasi temps réel (NRT) pour l'historique | FIRMS | À vérifier | Passer par l'outil Archive Download et non par le flux NRT |
| C6 | Données | Périodes couvertes : MODIS depuis 2000 (Terra) et 2002 (Aqua), VIIRS S-NPP depuis 2012 | Connaissance générale | À vérifier | La période où les deux capteurs coexistent (à partir de 2012) sert à calibrer et à valider |
| C7 | Accès | Le téléchargement demande un compte Earthdata Login ; l'API demande une clé `MAP_KEY` | FIRMS | À vérifier | Chaque membre de l'équipe doit créer ses accès avant de commencer |
| C8 | Accès | Limites de requêtes sur l'API FIRMS | FIRMS | À vérifier | Peut imposer de télécharger en masse via l'archive plutôt que d'interroger l'API |
| C9 | Volume | 25 ans de hotspots mondiaux représentent un gros volume | Estimation | À confirmer | Probablement restreindre le périmètre géographique (Argentine ?) |
| C10 | Fonctionnel | Afficher un calendrier : choisir un jour ou une période et une région, voir l'historique de l'activité | Défi | Ferme | Il faut un stockage interrogeable par date et par zone |
| C11 | Fonctionnel | Mettre en évidence les tendances, les anomalies et la saisonnalité | Défi | Ferme | Il faut calculer une référence (normale saisonnière) pour pouvoir détecter des anomalies |
| C12 | Fonctionnel | Analyses complémentaires | Défi | Optionnel | Bonus si on a le temps |
| C13 | Technique | Python 3.14 et uv | Équipe | Ferme | `pyproject.toml` et `.python-version` dans le repo |
| C14 | Technique | Polars pour le traitement des données | Équipe | Ferme | Pas de pandas dans le pipeline |
| C15 | Technique | Stockage en partitionnement Hive (Parquet) | Équipe | Ferme | Choisir les clés de partition, par exemple `sensor / year / month` |
| C16 | Équipe | Deux personnes, avec GitHub comme source de vérité | Équipe | Ferme | Il faut des règles de collaboration (branches, PR) |
| C17 | Organisation | Durée du hackathon et date limite de rendu | — | À confirmer | Détermine le périmètre réaliste |
| C18 | Organisation | Format du rendu (démo live, vidéo, repo, pitch) et critères du jury | — | À confirmer | Détermine où mettre l'effort, entre la rigueur de la méthode et le polish de l'app |

## Questions ouvertes

- Quelle **zone géographique** retenir : le monde entier, l'Argentine ou une province ?
- Quelle **unité harmonisée** : nombre de hotspots, jours de feu par cellule de grille, FRP agrégée ?
- Quelle **grille spatiale** commune (taille de cellule) et quel **pas de temps** (jour, mois) ?
- Comment **valider** l'harmonisation, par exemple sur des années de la période de coexistence non utilisées pour la calibration ?
- Quel **framework web** pour le calendrier ?
