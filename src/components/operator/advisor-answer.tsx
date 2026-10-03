import { BookOpen, Play, Globe, ArrowUpRight } from "lucide-react";
import { ChatMd } from "@/components/chat-md";
import { parseAdvisorResponse } from "@/lib/advisor-response";
export function AdvisorAnswer({ text }: { text: string }) {
  const response = parseAdvisorResponse(text);
  return <><ChatMd text={response.text} />{response.references.length > 0 && <div className="ar-advisor-references" aria-label="Answer references">
    {response.references.map((reference, i) => <a key={i} href={reference.url} target="_blank" rel="noopener noreferrer">
      {reference.kind === "youtube" ? <Play size={16} /> : reference.kind === "book" ? <BookOpen size={16} /> : <Globe size={16} />}
      <span><small>{reference.kind === "youtube" ? "Video" : reference.kind === "book" ? "Book" : "Read more"}</small><strong>{reference.title}</strong><em>{reference.detail}</em></span><ArrowUpRight size={13} />
    </a>)}
  </div>}</>;
}
