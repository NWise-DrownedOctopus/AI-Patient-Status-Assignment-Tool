# Level-of-Care Assistant

Mobile web tool that helps overnight physicians decide inpatient vs. observation
using the hospital's level-of-care guide. Advisory only. Synthetic data only.

## Run locally
npm install
npm run dev

## Structure (planned)
- src/rules/    one JSON file per condition
- src/engine.js plain JS rules engine 
- src/cases/    synthetic demo patients