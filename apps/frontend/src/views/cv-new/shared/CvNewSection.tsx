interface CvNewSectionProps {
  title: string;
  id: string;
  children: React.ReactNode;
}

export const CvNewSection = ({ title, id, children }: CvNewSectionProps) => {
  return (
    <section id={id} className="py-5 first:pt-4">
      <h3 className="mb-3 border-b-2 border-[#4a4a4a]/20 pb-1.5 text-sm font-bold uppercase tracking-widest text-[#4a4a4a] dark:border-white/20 dark:text-white/80 print:break-after-avoid">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
};
