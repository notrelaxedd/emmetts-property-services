import Image from "next/image";
import { cn } from "@/lib/utils";

type OvalPhotoProps = {
  src: string;
  alt: string;
  /** next/image `sizes` hint. */
  sizes: string;
  priority?: boolean;
  className?: string;
  /** Adjust the crop focus, e.g. "50% 30%". */
  position?: string;
};

/** A photo masked into a tall 3:4 ellipse, the flyer's signature frame. */
export function OvalPhoto({ src, alt, sizes, priority, className, position = "50% 50%" }: OvalPhotoProps) {
  return (
    <div className={cn("oval shadow-[0_30px_60px_-30px_rgb(11_11_11/0.55)]", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
        style={{ objectPosition: position }}
      />
    </div>
  );
}
