WORKED EXAMPLES
- score, tool success ratio (a failed tool call is a tool_result whose payload
  carries "error"; do not count separate error events for this):
  EvalResult(score=Score(round(len([e for e in session.events_of_type("tool_result") if not e.payload.get("error")]) / session.count("tool_result"), 4) if session.count("tool_result") else 1.0), reasoning="Fraction of tool results without an error.")
- score, any agent_end reports success (note the [] — never a bare generator):
  EvalResult(score=Score(1.0 if any([e.payload.get("outcome") == "success" for e in session.events_of_type("agent_end")]) else 0.0), reasoning="An agent_end event reports a success outcome.")
- assertion, the FINAL agent_end reports success (transcript is time-ordered — INDEX it, never sort with a lambda):
  EvalResult(assertions={"final_agent_end_success": Assertion(len(session.events_of_type("agent_end")) > 0 and session.events_of_type("agent_end")[-1].payload.get("outcome") == "success")}, reasoning="The last agent_end event reports outcome == success.")
- metric, model call count:
  EvalResult(metrics={"model_calls": Metric(session.count("model_request"))}, reasoning="Number of model requests in the session.")
- assertion, agent finished cleanly:
  EvalResult(assertions={"finished_clean": Assertion(len(session.events_of_type("error")) == 0 and session.count("agent_end") > 0)}, reasoning="No error events and the agent reached an end event.")
- condition (run only when the agent used tools):
  session.count("tool_use") > 0
