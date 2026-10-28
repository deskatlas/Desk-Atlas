"""QAD-TC44: experimental task framing without an extra inference round."""
from pydantic import Field, create_model
from rag.document_support import Composition


def framing(generate):
    async def call(prompt, data, schema):
        if not issubclass(schema, Composition) or 'answer' in data:
            return await generate(prompt, data, schema)
        class Framed(schema):
            original_task: str = Field(default='Unspecified', min_length=1, max_length=240)
            participants: str = Field(default='Unspecified', min_length=1, max_length=240)

            @classmethod
            def model_json_schema(cls, **kwargs):
                result = super().model_json_schema(**kwargs)
                properties = result['properties']
                result['properties'] = {key: properties[key] for key in ('original_task', 'participants', *[key for key in properties if key not in ('original_task', 'participants')])}
                return result
        return await generate('''Before selecting a procedure, fill original_task with a faithful restatement of the user's request and participants with who reports, who is affected, and who must act. A reporter is not presumed responsible for the reported problem. Then draft blocks that DIRECTLY address that original task. If the question reports a complaint, begin by responding to the complainant and identifying the responsible staff action, rather than addressing the complainant as the offender. Keep this reasoning short and ground all answer claims in the original evidence. ''' + prompt, data, Framed)
    return call
