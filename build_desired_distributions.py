import json
import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parent
DOCX_PATH = ROOT / "Google_Form_Questions_and_Answer_Choices_Current.docx"
QUESTIONS_PATH = ROOT / "form-questions.json"
OUTPUT_PATH = ROOT / "desired-distributions.js"


def document_paragraph_texts(path):
    document = Document(path)
    for paragraph in document.element.body.iter(qn("w:p")):
        parts = []
        for node in paragraph.iter():
            if node.tag == qn("w:t"):
                parts.append(node.text or "")
            elif node.tag == qn("w:tab"):
                parts.append("\t")
        text = "".join(parts)
        if text.strip():
            yield text.strip()


def extract_percentages(path):
    values = {}
    current_question = None
    for text in document_paragraph_texts(path):
        match = re.match(r"^\d+\.\s+(.+?)(?:\s+Required)?$", text)
        if match:
            current_question = match.group(1)
            values[current_question] = []
        if current_question is None:
            continue
        if "%" not in text:
            continue
        percentage_text = text.rsplit("\t", 1)[-1]
        before_percent = percentage_text.split("%", 1)[0]
        numbers = re.findall(r"\d+(?:[.,]\d+)?", before_percent)
        if numbers:
            values[current_question].append(float(numbers[-1].replace(",", ".")))
    return values


def flatten_questions(data):
    flattened = []
    for section in data["sections"]:
        shared_options = section.get("sharedOptions")
        for question in section["questions"]:
            options = question.get("options") or shared_options
            if not options:
                raise ValueError(f"Question has no answer choices: {question['question']}")
            flattened.append({**question, "options": options})
    return flattened


def build_distributions(questions, percentages):
    result = []
    for index, question in enumerate(questions, start=1):
        option_count = len(question["options"])
        question_percentages = percentages.get(question["question"])
        if question_percentages is None:
            raise ValueError(f"No percentages in Word for: {question['question']}")
        if len(question_percentages) > option_count:
            raise ValueError(f"Too many percentages in Word for: {question['question']}")
        # Newly added choices have no percentage in the earlier Word document.
        question_percentages = question_percentages + [0] * (
            option_count - len(question_percentages)
        )
        total = sum(question_percentages)
        if abs(total - 100) > 0.01:
            raise ValueError(
                f"Question {index} totals {total:g}%, expected 100%: {question['question']}"
            )

        result.append(
            {
                "number": index,
                "id": question["id"],
                "question": question["question"],
                "options": [
                    {"label": label, "percent": percentage}
                    for label, percentage in zip(
                        question["options"], question_percentages, strict=True
                    )
                ],
            }
        )
    return result


def main():
    with QUESTIONS_PATH.open("r", encoding="utf-8") as stream:
        questions_data = json.load(stream)

    questions = flatten_questions(questions_data)
    percentages = extract_percentages(DOCX_PATH)
    distributions = build_distributions(questions, percentages)
    payload = json.dumps(distributions, ensure_ascii=False, indent=2)
    OUTPUT_PATH.write_text(
        f"// Generated from {DOCX_PATH.name}.\n"
        f"globalThis.RANDOM_FORM_DESIRED_DISTRIBUTIONS = Object.freeze({payload});\n",
        encoding="utf-8",
    )
    print(
        f"Generated {OUTPUT_PATH.name}: {len(distributions)} questions, "
        f"{sum(map(len, percentages.values()))} answer percentages read from Word."
    )


if __name__ == "__main__":
    main()
