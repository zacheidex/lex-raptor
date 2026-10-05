import {SourceError} from './sources.js';
export const feedbackIssues=['incorrect','incomplete','sources','unclear','technical','other'];
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export async function saveFeedback(db,body,visitor,now,model) {
  if(!uuid(body.id)||!uuid(body.request_id)||!['helpful','needs_work'].includes(body.rating))throw new SourceError('Choose a feedback rating.');
  if(body.issue!==undefined&&body.issue!==''&&!feedbackIssues.includes(body.issue))throw new SourceError('Choose a feedback category.');
  if(body.comment!==undefined&&(typeof body.comment!=='string'||body.comment.length>2000))throw new SourceError('Keep feedback within 2,000 characters.');
  if(body.share_context!==undefined&&typeof body.share_context!=='boolean')throw new SourceError('Choose whether to share the question and answer.');
  let shared=null;
  if(body.share_context===true){
    if(typeof body.question!=='string'||body.question.length>2000||typeof body.answer!=='string'||body.answer.length>16000)throw new SourceError('The shared question or answer is too long. Send your note without it.');
    shared=JSON.stringify({question:body.question,answer:body.answer});
  }else if(body.question!==undefined||body.answer!==undefined)throw new SourceError('Sharing the question and answer requires your selection.');
  // No attachment, passage, conversation-history or arbitrary metadata fields
  // are copied. A vote is useful without retaining the user's legal question.
  const row=await db.prepare(`INSERT INTO research_feedback
    (id,visitor,created,updated,request_id,rating,issue,comment,model,shared_context)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE
      (SELECT COUNT(*) FROM research_feedback WHERE visitor=? AND created>?)<60
      OR EXISTS(SELECT 1 FROM research_feedback WHERE id=? AND visitor=?)
    ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,rating=excluded.rating,
      issue=excluded.issue,comment=excluded.comment,shared_context=excluded.shared_context
    WHERE research_feedback.visitor=excluded.visitor RETURNING id`).bind(
      body.id,visitor,now,now,body.request_id,body.rating,body.issue||'',body.comment?.trim()||'',model,shared,
      visitor,now-3600,body.id,visitor
    ).first();
  return !!row;
}
