import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# Model from .env, or pass one on the command line:
#   python test_llm.py moonshotai/Kimi-K2-Instruct
model = sys.argv[1] if len(sys.argv) > 1 else os.environ["LLM_MODEL"]

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

r = client.chat.completions.create(
    model=model,
    messages=[
        {"role": "system", "content": "/no_think"},
        {"role": "user", "content": "Reply with one short sentence: are you working?"},
    ],
    max_tokens=100,
    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
)

msg = r.choices[0].message
answer = (msg.content or "").strip()
reasoning = (getattr(msg, "reasoning", None) or getattr(msg, "reasoning_content", None) or "").strip()

print("Model:      ", model)
print("Answer:     ", answer or "(empty)")
print("Thinking:   ", f"{len(reasoning)} characters" if reasoning else "none")
print("Tokens used:", r.usage.completion_tokens, "of 100")
print("Cost (USD): ", getattr(r.usage, "cost", "n/a"))
print()

if answer and not reasoning and r.usage.completion_tokens < 100:
    print("RESULT: clean answer, thinking is off. This model is ready to use.")
elif answer and reasoning:
    print("RESULT: works, but it is still thinking first. Try: python test_llm.py moonshotai/Kimi-K2-Instruct")
else:
    print("RESULT: no answer came back. Send me this output (not your key).")