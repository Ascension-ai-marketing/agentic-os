import json, threading, tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from deepseek_harness import DeepSeekHarness
root=Path(__file__).resolve().parents[1]
requests=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  requests.append({'path':self.path,'body':body,'hasApiKey':bool(self.headers.get('x-api-key')),'hasBearer':self.headers.get('Authorization')=='Bearer fixture-dummy-not-a-credential'})
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  chunks=[{'id':'fixture','object':'chat.completion.chunk','model':'deepseek/deepseek-v4.1-flash','choices':[{'index':0,'delta':{'role':'assistant','content':'{"answer":"WIRE_OK","references":["demo-1"]}'},'finish_reason':None}]},{'id':'fixture','object':'chat.completion.chunk','model':'deepseek/deepseek-v4.1-flash','choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':20,'completion_tokens':2,'total_tokens':22,'completion_tokens_details':{'reasoning_tokens':0}}}]
  for chunk in chunks:self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
  self.wfile.write(b'data: [DONE]\n\n')
  self.wfile.flush()
server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory(prefix='agentic-dsh-wire-') as tmp:
  patch=Path(tmp)/'local-test.patch.yml'
  candidate=Path(__file__).with_name('inbox-dsh-companion.patch.yml').read_text()
  assert candidate.count('https://openrouter.ai/api/v1')==1
  patch.write_text(candidate.replace('https://openrouter.ai/api/v1','http://127.0.0.1:'+str(server.server_port)))
  with DeepSeekHarness(provider='openrouter',model='deepseek/deepseek-v4.1-flash',profile='sdk-minimal',dsh_home=str(root/'.operator-data/dsh'),cwd=tmp,patches=(str(root/'scripts/dsh-companion.patch.yml'),str(patch)),max_tokens=1024,reasoning_effort='off',base_url='http://127.0.0.1:'+str(server.server_port),api_key='fixture-dummy-not-a-credential',request_timeout_seconds=10,initialize_timeout_seconds=10) as harness:
   result=harness.run('Return JSON with answer WIRE_OK and references [demo-1].')
  if json.loads(result.final_response).get('answer')!='WIRE_OK': print(json.dumps({'finish':result.finish_reason,'requests':[{'path':r['path'],'keys':list(r['body']),'reasoning':r['body'].get('reasoning'),'model':r['body'].get('model')} for r in requests],'lastEvents':result.events[-3:]},default=str))
  assert json.loads(result.final_response)=={'answer':'WIRE_OK','references':['demo-1']}, repr(result.final_response)
  assert result.finish_reason=='completed', result.finish_reason
  assert len(requests)==1, len(requests)
  r=requests[0];print(json.dumps({'capturedPath':r['path'],'reasoning':r['body'].get('reasoning'),'maxTokens':r['body'].get('max_tokens'),'toolCount':len(r['body'].get('tools',[]))}));assert r['path']=='/chat/completions',r['path'];assert r['body']['model']=='deepseek/deepseek-v4.1-flash';assert r['body']['reasoning'].get('effort') == 'none';assert r['body']['max_tokens']==1024;assert not r['body'].get('tools');assert 'dsh_session_log' not in r['body'];assert 'dsh_plugin_packages' not in r['body'];assert not r['hasApiKey'];assert r['hasBearer']
  print(json.dumps({'passed':True,'path':r['path'],'model':r['body']['model'],'reasoning':r['body']['reasoning'],'maxTokens':r['body']['max_tokens'],'toolCount':len(r['body'].get('tools',[])),'sessionUpload':False,'inventoryUpload':False,'answer':result.final_response,'finishReason':result.finish_reason,'externalCalls':0}))
finally:server.shutdown()
