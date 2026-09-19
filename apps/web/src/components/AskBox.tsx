import { useState } from "react";
import { apiPost } from "../api";

type AskResponse = {
  answer_fr: string;
  sources: Array<{
    document_id: string;
    filename: string;
  }>;
};

export function AskBox() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (question.trim().length < 3) {
      setError("Ask a longer question.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiPost<AskResponse>("/api/ask", {
        question
      });
      setAnswer(response);
    } catch {
      setError("Semantic search is not available yet.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="ask-box">
      <div>
        <p className="eyebrow">T15 semantic search</p>
        <h2>Ask your documents</h2>
      </div>
      <div className="ask-box__input">
        <input
          value={question}
          placeholder="Ex: Quelles factures ont un risque TVA eleve ?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submit();
            }
          }}
        />
        <button type="button" disabled={isLoading} onClick={() => void submit()}>
          {isLoading ? "Searching" : "Ask"}
        </button>
      </div>
      {error ? <p className="notice notice--danger">{error}</p> : null}
      {answer ? (
        <div className="ask-box__answer">
          <p>{answer.answer_fr}</p>
          <div>
            <span>Sources</span>
            {answer.sources.length === 0 ? (
              <strong>No source</strong>
            ) : (
              answer.sources.map((source) => (
                <strong key={source.document_id}>{source.filename}</strong>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

