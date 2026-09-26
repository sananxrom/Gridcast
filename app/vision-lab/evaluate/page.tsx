import { notFound } from 'next/navigation';
import AttentionEvaluation from './client';

/** Human accuracy and runtime evaluation remains a local engineering route. */
export default function AttentionEvaluationPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AttentionEvaluation />;
}
