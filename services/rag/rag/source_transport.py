"""SDD-C21,C23: lossless source transport shared by preparation and answering."""


def compact_units(units):
    """Reset heading inheritance independently for every complete packet."""
    result, heading = [], None
    for unit in units:
        item = {key: value for key, value in unit.items() if key != 'heading'}
        if unit['heading'] != heading:
            item['heading'] = unit['heading']
        heading = unit['heading']
        result.append(item)
    return result


def indexed_units(units):
    """Lossless packet-local heading dictionary; canonical identities stay local."""
    headings, indexes, rows = [], {}, []

    def heading_index(value):
        if value not in indexes:
            indexes[value] = len(headings)
            headings.append(value)
        return indexes[value]

    for unit in units:
        heading = heading_index(unit['heading'])
        duplicates = [[context['i'], heading_index(context['heading'])]
                      for context in unit.get('also_at', [])]
        rows.append([unit['i'], heading, unit['text'], duplicates])
    return {'headings': headings, 'rows': rows}
