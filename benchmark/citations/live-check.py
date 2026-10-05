"""Live citation-review diagnostic. Uses the site's existing shared spending cap.
Run manually: python3 benchmark/citations/live-check.py URL OUTPUT.json
No API credentials needed; uses public/hypothetical facts only.
"""
import json,sys,time,uuid,urllib.request
from pathlib import Path
origin=sys.argv[1].rstrip('/')
archives='https://www.archives.gov/founding-docs/bill-of-rights-transcript'
dobbs='https://www.supremecourt.gov/opinions/21pdf/19-1392_6j37.pdf'
georgia='https://law.justia.com/codes/georgia/2024/title-9/chapter-3/article-2/section-9-3-32/'
cases=[
 ('accurate_html','The text of the First Amendment prohibits Congress from making laws abridging freedom of speech.',archives,'supported'),
 ('wrong_html','The First Amendment requires Congress to license every newspaper before publication.',archives,'contradicted'),
 ('accurate_pdf','In its June 24, 2022 Dobbs decision, the Supreme Court overruled Roe v. Wade and Planned Parenthood v. Casey.',dobbs,'supported'),
 ('wrong_pdf','In its June 24, 2022 Dobbs decision, the Supreme Court reaffirmed Roe and Casey and preserved their constitutional abortion right.',dobbs,'contradicted'),
 ('accurate_mirror','The 2024 edition of Georgia Code section 9-3-32 states a four-year period after accrual for recovery of personal property or damages for its conversion or destruction.',georgia,'supported'),
 ('wrong_mirror','The 2024 edition of Georgia Code section 9-3-32 states a one-year period after accrual for recovery of personal property or damages for its conversion or destruction.',georgia,'contradicted'),
 ('missing_page','This nonexistent test page establishes a three-day filing deadline.','https://www.archives.gov/lexraptor-nonexistent-test-20261005','unverified')]
body={'request_id':str(uuid.uuid4()),'findings':[{'claim':claim,'urls':[url]} for _,claim,url,_ in cases]}
request=urllib.request.Request(origin+'/api/demo/verify',data=json.dumps(body).encode(),headers={'User-Agent':'LexRaptor-Citation-Benchmark/1.0','Origin':origin,'Content-Type':'application/json','Accept':'text/event-stream'})
started=time.time();events=[];result=None
with urllib.request.urlopen(request,timeout=400) as response:
 for line in response:
  text=line.decode().strip()
  if text.startswith('event: '):event=text[7:]
  if text.startswith('data: '):
   data=json.loads(text[6:]);events.append({'event':event,'data':data})
   if event=='progress':print(data.get('message'),flush=True)
   if event in ('result','error'):result=data
output={'request_id':body['request_id'],'duration_seconds':round(time.time()-started,2),'cases':[{'name':name,'claim':claim,'url':url,'expected':expected} for name,claim,url,expected in cases],'events':events,'result':result}
Path(sys.argv[2]).write_text(json.dumps(output,indent=2))
for case,got in zip(output['cases'],(result or {}).get('findings',[])):print(case['name'],case['expected'],'->',got['verdict'],got['reason'],flush=True)
if not result or 'error' in result:print(json.dumps(result));sys.exit(1)
