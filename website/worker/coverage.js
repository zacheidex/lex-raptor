// Coverage statements come from connector capabilities, not generated law.
const gaps={
  state_codes:'State statutes and local ordinances are not directly connected. CourtListener may provide cases discussing them; check the current official code before relying on a statutory rule.',
  federal_statutes:'The U.S. Code is not directly connected. eCFR contains federal regulations, not federal statutes. Cases may discuss statutes; check the current official statutory text.',
  foreign_law:'The connected databases focus on U.S. law and do not provide comprehensive foreign law coverage.',
  live_facts:'These databases do not verify live news, personal records, or case-specific docket status.'
};
export const coverageKinds=Object.keys(gaps);
export function coverageNotes(kinds=[]) {return [...new Set(kinds)].filter(k=>Object.hasOwn(gaps,k)).map(k=>gaps[k]);}
