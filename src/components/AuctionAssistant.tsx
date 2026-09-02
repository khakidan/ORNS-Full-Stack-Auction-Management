import { useState, useRef, useEffect } from "react";
import { useAuction } from "@/context/AuctionContext";
import { fetchWithRetry, getBaseUrl } from "@/lib/google-api";
import { IconButton } from "@/components/ui/IconButton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Send, Bot, User, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "model";
  text: string;
}

export default function AuctionAssistant({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { bidders, items } = useAuction();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "model", text: "Hello! I'm your Auction Pro Assistant. How can I help you manage the event today?" }
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = input;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);

    try {
      const context = `
        You are an AI assistant for a charity auction. 
        Current status:
        - Total Bidders: ${bidders.length}
        - Checked In: ${bidders.filter(b => b.checkedIn).length}
        - Total Items: ${items.length}
        
        Bidders list (sample): ${bidders.slice(0, 5).map(b => `${b.firstName} ${b.lastName} (#${b.id})`).join(", ")}
        Items list (sample): ${items.slice(0, 5).map(i => `${i.name} (#${i.id})`).join(", ")}
        
        Help the user run the auction. You can answer questions about attendees, help find item numbers, or suggest improvements to the workflow.
      `;

      const response = await fetchWithRetry(`${getBaseUrl()}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Important: avoid passing the very first welcome message as it wastes tokens
        body: JSON.stringify({ context, message: userMsg, history: messages.slice(1) }),
        credentials: "include"
      });

      if (!response.ok) {
        let msg = "Assistant error";
        try {
          const data = await response.json();
          if (data.fallback) {
            msg = "I'm having trouble thinking right now. Please try again soon.";
          }
        } catch(e) {}
        throw new Error(msg);
      }
      
      const data = await response.json();
      
      if (data.fallback) {
         throw new Error("I'm having trouble connecting to my brain right now.");
      }
      
      setMessages(prev => [...prev, { role: "model", text: data.text }]);
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: "model", text: `Error: ${error.message || "I'm having trouble connecting to my brain right now."}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex flex-col h-full sm:max-w-md p-0">
        <SheetHeader className="p-6 border-b bg-primary/5">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Auction AI Assistant
          </SheetTitle>
          <SheetDescription>
            Ask me anything about the auction, bidders, or items.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div className={cn("flex gap-3 max-w-[85%]", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                  <div className={cn(
                    "mt-1 h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                    msg.role === "user" ? "bg-slate-200" : "bg-primary/20"
                  )}>
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4 text-primary" />}
                  </div>
                  <div className={cn(
                    "rounded-2xl px-4 py-2 text-sm",
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-slate-100"
                  )}>
                    <div className="markdown-body">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                 <div className="flex gap-3 max-w-[85%]">
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl px-4 py-2 text-sm text-muted-foreground animate-pulse">
                    Thinking...
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-slate-50">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="flex gap-2"
          >
            <Input 
              placeholder="Ask a question..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <IconButton type="submit" aria-label="Send message" icon={<Send className="w-4 h-4" />} disabled={loading || !input.trim()} />
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
