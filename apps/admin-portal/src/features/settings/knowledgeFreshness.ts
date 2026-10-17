// MS51-TC06 / QAD-TC45: last-started read wins; mutations fence earlier reads.
export class KnowledgeFreshness {
  private generation = 0;
  private writing = false;
  beginRead(): number | null { return this.writing ? null : ++this.generation; }
  accepts(generation: number | null): boolean { return generation !== null && !this.writing && generation === this.generation; }
  beginWrite(): boolean {
    if (this.writing) return false;
    this.writing = true; this.generation++; return true;
  }
  endWrite(): void { this.writing = false; this.generation++; }
  reset(): void { this.writing = false; this.generation++; }
}
