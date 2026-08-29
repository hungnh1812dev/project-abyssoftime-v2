import { Github, Linkedin, Mail, MapPin, Phone } from "lucide-react";
import Image from "next/image";

import localAvatar from "@/assets/images/avatar.jpg";
import type { CvContactType } from "@/views/cv/contact.types";

import styles from "./CvNewHeader.module.css";

interface CvNewHeaderProps {
  contact: CvContactType;
  position: string;
}

export const CvNewHeader = ({ contact, position }: CvNewHeaderProps) => {
  return (
    <header className={`bg-muted px-6 py-6 text-foreground sm:px-8 sm:py-8 ${styles.header}`}>
      <div className="flex items-start gap-5 sm:gap-6">
        <Image
          src={contact.avatar.url || localAvatar.src}
          alt="Profile Avatar"
          width={110}
          height={110}
          className="block h-24 w-24 shrink-0 rounded-lg border-2 border-primary/50 object-cover sm:h-[110px] sm:w-[110px]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-bold tracking-tight text-primary sm:text-3xl">{contact.name}</h1>
          <h2 className="m-0 mt-1 text-sm font-normal uppercase tracking-[0.2em] text-foreground/80 sm:text-base">{position}</h2>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm text-foreground/80 sm:grid-cols-2">
            <a href={`tel:${contact.phone}`} className="flex items-center gap-2 hover:text-primary">
              <Phone className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              {contact.phone}
            </a>
            <span className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              {contact.address}
            </span>
            <a href={`mailto:${contact.email}`} className="flex items-center gap-2 hover:text-primary">
              <Mail className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              {contact.email}
            </a>
            {contact.github && (
              <a href={contact.github} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary">
                <Github className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
                {contact.github}
              </a>
            )}
            <a href={contact.linkedin} target="_blank" rel="noopener noreferrer " className="flex items-center gap-2 hover:text-primary sm:col-span-2">
              <Linkedin className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              {contact.linkedin}
            </a>
          </div>
        </div>
      </div>
    </header>
  );
};
