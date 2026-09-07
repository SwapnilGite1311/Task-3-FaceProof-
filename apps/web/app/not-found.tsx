import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-5 py-32 text-center sm:px-8">
      <div className="hash text-[13px] text-mist-600">404</div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-mist-50">
        No such page
      </h1>
      <p className="mt-4 text-[14.5px] leading-relaxed text-mist-400">
        The address you followed does not correspond to anything in FaceProof.
      </p>
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">
          <ArrowLeft />
          Back to the overview
        </Link>
      </Button>
    </div>
  );
}
