# Julius Juodagalvis - Professional Profile

Senior Data Scientist at Algori. Python professional since 2017. Background spans QA engineering, backend development, and data science. Colleagues note code is readable and maintainable. Passively open to opportunities with salary floor ~5k/month.

LinkedIn: https://www.linkedin.com/in/julius-juodagalvis/

---

## Core Skills

**Languages & Tools**
- Python (since 2017, daily driver) - passed LinkedIn skill assessment
- C++, Django, PostgreSQL, Linux, Git - all passed LinkedIn skill assessment
- Keras, PyTorch, TensorFlow, Scikit-Learn, Pandas, Jupyter
- Docker, Microsoft Azure

**ML / AI**
- Large Language Models (LLM), Prompt Engineering
- Machine Learning, Deep Learning - passed LinkedIn skill assessment
- OCR (Optical Character Recognition)
- Agentic automation (emerging - LLM-driven workflows with browser/tool control)

**Industry Knowledge**
- Data Science, Statistics, Mathematics, Quantitative Analytics
- Data Warehousing, Databases
- Automated Software Testing, QA, Test Automation
- Software Development, Backend Engineering

**Cloud**
- Azure: primary, comfortable taking design lead
- GCP / AWS: minimal, would not take design lead

---

## Notable Projects

### LLM Receipt Photo → Structured Data Extraction (Algori, production)
- 97% accuracy. Human ceiling is ~98% (2% of receipts are too blurry to read).
- Cost ~2x best OCR + text analysis - competitive for the accuracy gain.
- LLM with few-shot prompting; examples pulled from DB at setup and cached.

### Product Name → AECOC Category Classifier (Algori, production, NLP)
- BERT family. Input is shortened product names, often with OCR errors.
- Tiny, patchy hand-labeled training data. No similar known product at time of building.
- 9/10 values confirmed correct by human review. Returning to improve in ~6 months.

### Store Sales Estimator (Algori, applied statistics)
- Estimates sales of a specific store to within a few % from a non-random receipt sample.
- Non-trivial: sample is not truly random, requires careful statistical treatment.
- Also produces accurate overall retailer sales figures.

### Conversational DB Agent (Turing College, RAG)
- Natural language query → understand intent → generate SQL → retrieve structured data → inject into prompt → answer.
- Dynamic retrieval per query. Text-to-SQL RAG pattern over a relational database.

### LinkedIn Recruiter Sweep (agentic automation, emerging)
- Playwright browser automation + LLM classification of recruiter messages.
- Extracts job details, surfaces salary info, flags relevant opportunities.

---

## Career Timeline

- 2015: First exposure to ML/NLP via Coursera. No DS market in Lithuania yet.
- 2017: Professional data science career begins. Python as daily driver.
- Most professional work: structured data, invoice/receipt extraction.
- Classical NLP (BERT): ~6-7 months focused work, 3-4 months fixes, then ongoing.
- LLM production work at Algori: second project there, early 2024 at latest.
- Personal/uni NLP projects add ~1 year on top of professional time.

---

## Honest Caveats (for recruiter conversations)

- **Generative NLP "3+ years"**: Professional LLM work started ~2024. Combined with classical NLP and personal projects it's borderline - frame as depth + field evolution, not raw years.
- **RAG**: Has text-to-SQL RAG (Turing College) and static example retrieval (Algori). No production vector-search RAG yet.
- **GCP/AWS**: Real but minimal. Would not claim design lead on either.
- **No formal postgrad degree**: Not a blocker at most companies - lead with applied research depth.
