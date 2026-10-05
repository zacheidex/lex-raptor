// Identical bounded conversation context in the browser and CLI. Previous model
// output is task data, never authority or an instruction to the next model call.
export function conversationContext(history) {
  return history.slice(-3).map(r=>'User: '+r.question+'\nResolved topic: '+(r.query||'')+'\n'+
    (r.follow_up?'Assistant follow-up: '+r.follow_up.message:'Previous draft (unverified): '+(r.propositions||[]).map(p=>p.claim).join(' ').slice(0,650))
  ).join('\n\n').slice(-3500);
}
