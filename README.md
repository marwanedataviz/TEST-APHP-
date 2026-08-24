# Dashboard de suivi — Déploiement AP-HP

Suivi du déploiement de 2 applicatifs sur les hôpitaux AP-HP :
- **Hospitalisation Complète** (détail par service/UF)
- **Chambre mortuaire** (maille site, pas de détail par UF)

## Ouvrir le projet dans VS Code

1. Ouvre ce dossier dans VS Code (`Fichier > Ouvrir le dossier...`)
2. Installe l'extension **Live Server** si tu ne l'as pas déjà
3. Clic droit sur `index.html` → **Open with Live Server** (ou double-clique dessus pour l'ouvrir directement dans le navigateur)

## Structure du projet

```
├── index.html                          → structure de la page
├── style.css                            → mise en forme
├── app.js                                → logique (carte, fiche, sélecteur d'applicatif)
├── data.js                               → données générées (NE PAS éditer à la main)
├── coords.js                             → coordonnées GPS des hôpitaux (généré)
├── import.js                             → import Excel navigateur (filet de sécurité)
├── generate_data.py                      → script principal de génération des données
├── Dep_APHP.xlsx                         → fichier source "Hospitalisation Complète"
└── base_de_donnees_maille_site.xlsx      → fichier source "Chambre mortuaire"
```

## Mettre à jour les données (méthode principale)

1. Remplace le fichier Excel concerné (`Dep_APHP.xlsx` ou `base_de_donnees_maille_site.xlsx`) par la nouvelle version, en gardant **exactement le même nom de fichier**
2. Dans le terminal VS Code :
```bash
python generate_data.py
```
3. Recharge la page dans le navigateur — c'est à jour.

Si le script signale des **hôpitaux sans coordonnées connues**, c'est qu'un nouvel établissement apparaît dans l'export : ajoute ses coordonnées GPS dans le dictionnaire `HOPITAL_COORDS` en haut de `generate_data.py`.

## Mettre à jour les données (filet de sécurité — sans VS Code)

Le bouton d'import (icône 📤 dans le bandeau) permet de déposer un nouveau fichier Excel directement depuis le navigateur, sans passer par le script Python. Il importe les données pour **l'applicatif actuellement sélectionné** (Hospitalisation Complète ou Chambre mortuaire) — pense à bien être sur le bon onglet avant d'importer.

⚠️ Cette méthode ne modifie que ce qui est affiché à l'écran, pas les fichiers Excel sources ni `data.js`. Au prochain rechargement de page (ou si `generate_data.py` est relancé), les données importées manuellement sont perdues. Pour une mise à jour durable, utilise la méthode principale (script Python).

## Calcul des taux

- **Hospitalisation Complète** : le fichier source n'a que 2 statuts réels (Déployé / Non concerné, jamais "Non Déployé"). Le taux se calcule donc sur `Déployé / (Déployé + Non concerné)`.
- **Chambre mortuaire** : les 3 statuts existent (Déployé / Non Déployé / Non concerné). Le taux se calcule sur `Déployé / (Déployé + Non Déployé)`, "Non concerné" étant exclu du calcul.

## Points encore en attente

- **Taux global du bandeau** : actuellement une valeur fixe (78%), en attendant que l'équipe projet communique la formule officielle à appliquer.
- **Coordonnées des hôpitaux** : positions approximatives. À vérifier avec la base FINESS/Atlasanté si une précision certifiée est nécessaire un jour.
- **Chambre mortuaire** : le fichier source actuel ne couvre que 11 hôpitaux sur 36 (le reste n'a pas encore de données renseignées).
