import type { Metadata } from 'next';
import { VerificationView } from '@/components/verify/verification-view';

export const metadata: Metadata = {
  title: 'Verification',
  description: 'Live verification pipeline and results.',
};

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VerificationView id={id} />;
}
