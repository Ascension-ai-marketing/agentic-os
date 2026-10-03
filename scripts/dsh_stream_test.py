import io
import json
import unittest
import urllib.request
import urllib.error
from dsh_stream import HarnessStreamRelay

class Response(io.BytesIO):
    status = 200
    headers = {"Content-Type": "text/event-stream"}

class RelayTests(unittest.TestCase):
    def test_actual_response_reaches_harness_and_only_visible_text_is_observed(self):
        wire = b'data: {"choices":[{"delta":{"reasoning":"PRIVATE_REASONING"}}]}\n\n' + (
            'data: '+json.dumps({"choices":[{"delta":{"content":"café 世界"}}]}, ensure_ascii=False)+'\n\ndata: [DONE]\n\n').encode()
        calls=[]; events=[]
        def upstream(request, **kwargs):
            calls.append(request)
            return Response(wire)
        with HarnessStreamRelay("PRIVATE_KEY", events.append, upstream) as relay:
            req=urllib.request.Request(relay.base_url+"/chat/completions", data=b'{"model":"synthetic","stream":true}',headers={"Authorization":"Bearer "+relay.token})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.read(),wire)
            self.assertEqual(events,[{"type":"delta","text":"café 世界"}])
            self.assertEqual(calls[0].full_url,"https://openrouter.ai/api/v1/chat/completions")
            self.assertEqual(calls[0].headers["Authorization"],"Bearer PRIVATE_KEY")
            self.assertNotIn("PRIVATE",json.dumps(events))
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(req)
            self.assertEqual(error.exception.code,409)
    def test_loopback_route_requires_per_run_token_before_any_upstream_request(self):
        called=[]
        with HarnessStreamRelay("KEY",lambda event:None,lambda *a,**kw:called.append(a)) as relay:
            for suffix,header,status in [("/chat/completions","wrong",403),("/elsewhere",relay.token,404)]:
                req=urllib.request.Request(relay.base_url+suffix,data=b'{}',headers={"Authorization":"Bearer "+header})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(req)
                self.assertEqual(error.exception.code,status)
            self.assertEqual(called,[])
    def test_observer_preserves_delta_boundaries_and_drops_reasoning(self):
        events=[];relay=HarnessStreamRelay("KEY",events.append)
        for text in ["one", " two"]:
            relay.observe(('data: '+json.dumps({"choices":[{"delta":{"content":text,"reasoning":"HIDDEN"}}]})).encode())
        self.assertEqual(relay.text,"one two")
        self.assertEqual(len(events),2)

if __name__ == '__main__': unittest.main()
