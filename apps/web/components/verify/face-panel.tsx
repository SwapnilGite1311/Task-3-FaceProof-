'use client';

import { ScanFace } from 'lucide-react';
import { formatBytes, type FaceDetectionSummary, type FaceEncodingSummary, type ImageAnalysis } from '@faceproof/shared';
import { Badge } from '@/components/ui/badge';
import { DataRow, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { HashValue } from '@/components/ui/hash-value';
import { FacePreview } from './face-preview';

export function FacePanel({
  imageUrl,
  image,
  face,
  encoding,
  scanning,
  className,
}: {
  imageUrl: string;
  image: ImageAnalysis;
  face: FaceDetectionSummary | null;
  encoding: FaceEncodingSummary | null;
  scanning: boolean;
  className?: string;
}) {
  const primary = face?.faces[0];

  return (
    <Panel className={className}>
      <PanelHeader
        eyebrow="Steps 01–03 · Image, detection, encoding"
        title={
          face
            ? face.faceDetected
              ? `${face.faceCount} face${face.faceCount === 1 ? '' : 's'} detected`
              : 'No face detected'
            : 'Analysing image'
        }
        action={
          face?.faceDetected ? (
            <Badge tone="success">
              <ScanFace className="size-3" />
              Detected
            </Badge>
          ) : null
        }
      />

      <div className="p-5 sm:p-6">
        <FacePreview
          imageUrl={imageUrl}
          face={face}
          scanning={scanning}
          className="mx-auto max-h-[420px] w-full"
        />
      </div>

      <PanelBody className="py-2">
        <dl>
          <DataRow label="File">
            <span className="truncate text-mist-100">{image.filename}</span>
          </DataRow>
          <DataRow label="Dimensions">
            {image.width} × {image.height} px · {formatBytes(image.byteSize)} · {image.mimeType}
          </DataRow>
          <DataRow label="Input SHA-256" align="start">
            <HashValue value={image.sha256} label="input image hash" />
          </DataRow>
          <DataRow label="Perceptual hash">
            <HashValue value={image.perceptualHash} grouped={false} label="perceptual hash" />
          </DataRow>

          {primary ? (
            <>
              <DataRow label="Detector">
                <span className="font-mono text-[12.5px] text-mist-300">{face?.detector}</span>
              </DataRow>
              <DataRow label="Bounding box" align="start">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-[12.5px] tabular-nums text-mist-200 sm:grid-cols-4">
                  <span>x: {primary.box.x}</span>
                  <span>y: {primary.box.y}</span>
                  <span>w: {primary.box.width}</span>
                  <span>h: {primary.box.height}</span>
                </div>
              </DataRow>
              <DataRow label="Detection score">
                <span className="font-mono tabular-nums text-mist-100">
                  {(primary.score * 100).toFixed(2)}%
                </span>
                <span className="ml-3 text-[12.5px] text-mist-500">
                  {primary.landmarkCount} landmarks
                </span>
              </DataRow>
            </>
          ) : null}

          {encoding ? (
            <DataRow label="Embedding">
              <span className="text-mist-100">
                {encoding.dimensions}-D, L2-normalised
              </span>
              <span className="ml-2 font-mono text-[12px] text-mist-500">{encoding.model}</span>
            </DataRow>
          ) : null}
        </dl>

        {face?.faceCount && face.faceCount > 1 ? (
          <p className="mt-4 rounded-lg border border-amber-warn/25 bg-amber-warn/[0.05] p-3.5 text-[13px] leading-relaxed text-amber-warn">
            {face.faceCount} faces were found. The highest-confidence face is the one used for
            matching; the others are shown but not compared.
          </p>
        ) : null}

        <p className="mt-4 text-[12px] leading-relaxed text-mist-600">
          The embedding derived from this image is held in memory for the duration of this job and
          then discarded. It is never written to the database and never sent to the blockchain.
        </p>
      </PanelBody>
    </Panel>
  );
}
