# Forecast.Solar

Cette intégration affiche dans Gladys la **prévision de production** de vos
panneaux solaires, calculée par le service gratuit
[Forecast.Solar](https://forecast.solar) à partir de la météo prévue.

## Ce que vous obtenez

Un appareil **Solar forecast** avec 4 capteurs :

| Capteur                          | Unité | Contenu                                       |
| -------------------------------- | ----- | --------------------------------------------- |
| Estimated power now              | W     | Puissance estimée en ce moment                |
| Estimated energy today           | kWh   | Production estimée sur toute la journée       |
| Estimated energy remaining today | kWh   | Production estimée d'ici la fin de la journée |
| Estimated energy tomorrow        | kWh   | Production estimée pour demain                |

Ce sont des **prévisions**, pas des mesures : elles ne sont pas comptées dans
le suivi d'énergie de Gladys. Elles servent par exemple à lancer un appareil
(chauffe-eau, lave-linge…) quand une bonne production est prévue.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Renseignez :
   - **Latitude / Longitude** : position des panneaux (clic droit sur
     Google Maps ou OpenStreetMap pour les obtenir) ;
   - **Inclinaison** : 0° = à plat, 90° = vertical (souvent 30 à 35° sur un toit) ;
   - **Orientation** : 0° = sud, -90° = est, 90° = ouest, 180° = nord ;
   - **Puissance crête** en kWc (indiquée sur votre contrat ou votre onduleur).
3. La **clé d'API** est facultative : laissez vide pour l'offre gratuite.
4. Enregistrez, puis ajoutez l'appareil depuis l'onglet **Découverte**.

Le bouton **Mettre à jour la prévision maintenant** télécharge la prévision
tout de suite et affiche le résumé du jour et du lendemain.

## Fonctionnement

- La prévision est téléchargée toutes les 60 minutes par défaut
  (réglable de 15 à 1440 minutes).
- Entre deux téléchargements, les valeurs sont recalculées et publiées toutes
  les 5 minutes (la puissance suit la courbe du soleil).
- L'offre gratuite autorise **12 requêtes par heure** et par adresse IP.
  En cas d'erreur ou de limite atteinte, l'intégration réessaie 15 minutes
  plus tard et garde la dernière prévision connue.
- Un seul plan de panneaux est géré. Pour une installation est/ouest,
  indiquez l'orientation et la puissance du plan principal.

## Dépannage

- **« Configuration incomplète ou invalide »** dans l'écran de configuration :
  un champ obligatoire est vide ou hors limites (le nom du champ est indiqué).
- **« Limite de requêtes Forecast.Solar atteinte »** : trop de requêtes depuis
  votre adresse IP (autre logiciel qui utilise aussi Forecast.Solar ?).
  Augmentez l'intervalle de mise à jour.
- Pour le détail, consultez les logs de l'intégration depuis Gladys (ou
  `docker logs` sur l'hôte) avec `LOG_LEVEL=debug`.
