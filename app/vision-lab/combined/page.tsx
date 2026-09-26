import { notFound } from 'next/navigation';
import CombinedAttentionEvaluation from './client';

/** The A2 harness is a local engineering tool, never a public production route. */
export default function CombinedEvaluationPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <CombinedAttentionEvaluation />;
}
