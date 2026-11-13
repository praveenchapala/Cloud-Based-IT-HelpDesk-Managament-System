import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, MessageCircle, Send, Trash2, X } from "lucide-react";
import { sendChatMessage } from "../services/api";
import "./ResolveBot.css";

const INITIAL_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm ResolveBot, your IT helpdesk assistant. Describe the issue you're facing, and I'll help you troubleshoot it. Please don't share passwords or verification codes.",
};

export default function ResolveBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      messageListRef.current?.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: "smooth",
      });
      inputRef.current?.focus();
    }
  }, [isOpen, messages, isSending]);

  async function handleSubmit(event) {
    event.preventDefault();
    const message = input.trim();

    if (!message || isSending) return;

    const userMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: message,
    };
    const previousMessages = messages
      .filter((item) => item.role === "user" || item.role === "assistant")
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setIsSending(true);

    try {
      const response = await sendChatMessage({
        message,
        history: previousMessages.filter((item) => item.role !== "assistant" || item.content !== INITIAL_MESSAGE.content),
      });
      const answer = response?.data?.answer;

      if (!response?.success || typeof answer !== "string" || !answer.trim()) {
        throw new Error("ResolveBot returned an unexpected response.");
      }

      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: answer.trim(),
        },
      ]);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Unable to contact ResolveBot. Please try again."
      );
    } finally {
      setIsSending(false);
    }
  }

  function clearConversation() {
    if (isSending) return;
    setMessages([INITIAL_MESSAGE]);
    setError("");
  }

  return (
    <div className="resolvebot-root">
      {isOpen && (
        <section
          className="resolvebot-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="resolvebot-title"
        >
          <header className="resolvebot-header">
            <div className="resolvebot-heading">
              <span className="resolvebot-avatar"><Bot size={20} /></span>
              <div>
                <h2 id="resolvebot-title">ResolveBot</h2>
                <p><span className="resolvebot-online-dot" /> IT support assistant</p>
              </div>
            </div>
            <div className="resolvebot-header-actions">
              <button type="button" onClick={clearConversation} disabled={isSending} aria-label="Clear conversation" title="Clear conversation">
                <Trash2 size={17} />
              </button>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close ResolveBot">
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="resolvebot-messages" ref={messageListRef} aria-live="polite">
            {messages.map((item) => (
              <div className={`resolvebot-message-row ${item.role}`} key={item.id}>
                {item.role === "assistant" && <span className="resolvebot-message-avatar"><Bot size={15} /></span>}
                <div className={`resolvebot-message ${item.role}`}>
                  <p>{item.content}</p>
                </div>
              </div>
            ))}
            {isSending && (
              <div className="resolvebot-message-row assistant">
                <span className="resolvebot-message-avatar"><Bot size={15} /></span>
                <div className="resolvebot-message assistant resolvebot-typing">
                  <LoaderCircle size={16} className="resolvebot-spinner" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
            {error && <p className="resolvebot-error" role="alert">{error}</p>}
          </div>

          <form className="resolvebot-composer" onSubmit={handleSubmit}>
            <label className="resolvebot-sr-only" htmlFor="resolvebot-input">Message ResolveBot</label>
            <textarea
              id="resolvebot-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Describe your IT issue..."
              maxLength={2000}
              rows={2}
              disabled={isSending}
            />
            <button type="submit" disabled={!input.trim() || isSending} aria-label="Send message">
              <Send size={17} />
            </button>
          </form>
          <p className="resolvebot-disclaimer">AI responses can be inaccurate. Don't share passwords or sensitive information.</p>
        </section>
      )}

      <button
        type="button"
        className={`resolvebot-launcher ${isOpen ? "is-open" : ""}`}
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "Close ResolveBot" : "Open ResolveBot"}
        aria-expanded={isOpen}
      >
        {isOpen ? <X size={23} /> : <MessageCircle size={23} />}
        {!isOpen && <span>Ask ResolveBot</span>}
      </button>
    </div>
  );
}
