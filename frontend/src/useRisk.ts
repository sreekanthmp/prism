import { useCallback, useRef, useState } from "react";
import { tradesApi, type TradesApi } from "./tradesApi";
import { blankRisk, riskOf, riskQuery, type RiskForm, type RiskOut } from "./tradesModel";

export interface RiskState {
  form: RiskForm;
  setField: (field: keyof RiskForm, value: string) => void;
  out: RiskOut | null; // what the last Calculate said
  calc: () => Promise<void>;
}

/** The size calculator: how many lots keep the loss at YOUR stop inside YOUR limits. It asks only when Calculate is clicked, and only sends what was filled in. What is typed and what it said are the
 *  page's, so leaving the tab and coming back finds them as they were. The latest ask is the one that is shown. */
export function useRisk(api: TradesApi = tradesApi): RiskState {
  const [form, setForm] = useState<RiskForm>(blankRisk);
  const [out, setOut] = useState<RiskOut | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const apiRef = useRef(api);
  apiRef.current = api;
  const latest = useRef(0);

  const calc = useCallback(async () => {
    const mine = ++latest.current;
    let result: RiskOut;
    try {
      result = riskOf(await apiRef.current.risk(riskQuery(formRef.current)));
    } catch (e) {
      result = { error: String(e) };
    }
    if (mine === latest.current) setOut(result);
  }, []);

  const setField = useCallback((field: keyof RiskForm, value: string) => setForm((f) => ({ ...f, [field]: value })), []);
  return { form, setField, out, calc };
}
